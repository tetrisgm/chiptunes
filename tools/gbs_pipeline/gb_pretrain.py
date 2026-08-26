"""Resumable chunk trainer for the Game Boy LM.

Designed for an unattended loop: each invocation resumes from latest.pt, trains
for --train-seconds, evaluates held-out loss, keeps best.pt by validation loss,
and appends a compact eval record. Transposition augmentation shifts melodic
pitch tokens per window (channel ranges are contiguous, so a shift is integer
addition), which multiplies the effective corpus ~10x.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

try:
    from .gb_lm2 import GbLm, GbLmConfig, load_config, save_config
except ImportError:
    from gb_lm2 import GbLm, GbLmConfig, load_config, save_config

# The tracker vocabulary keeps every melodic pitch in ONE contiguous block
# (channel is a separate ON_ch token), so transposition is a single shift.
# Reading the range from the corpus rather than importing constants avoids
# silently corrupting tokens when the layout changes.
BOS = 1
MELODIC_LOW = 0
MELODIC_HIGH = 0
PITCHES = 0


def bind_vocab(corpus: Path) -> None:
    global MELODIC_LOW, MELODIC_HIGH, PITCHES, BOS
    meta = json.loads((corpus / "vocab.json").read_text(encoding="utf-8"))
    lay = meta["layout"]
    BOS = int(lay["BOS"])
    MELODIC_LOW = int(lay["NOTE0"])
    PITCHES = int(meta["maxMidi"]) - int(meta["minMidi"]) + 1
    MELODIC_HIGH = MELODIC_LOW + PITCHES


def load_split(corpus: Path, split: str) -> np.ndarray:
    tokens = np.load(corpus / "tokens.npy", mmap_mode="r")
    offsets = np.asarray(np.load(corpus / "token-offsets.npy"))
    with (corpus / "tracks.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    picked = [np.asarray(tokens[int(offsets[r["track"]]):
                                int(offsets[r["track"] + 1])])
              for r in rows if r["split"] == split and r["tokens"] > 0]
    return (np.concatenate(picked) if picked
            else np.zeros(0, dtype=np.uint16)).astype(np.int64)


def load_tracks(corpus: Path, split: str) -> list[dict]:
    """Per-track arrays plus their conditioning prefix.

    Concatenating every track into one stream and slicing at random splices the
    tail of one game onto the head of another, and — now that tracks carry a
    style prefix — hides that prefix from all but the first window. Keeping
    tracks separate fixes both.
    """
    tokens = np.load(corpus / "tokens.npy", mmap_mode="r")
    offsets = np.asarray(np.load(corpus / "token-offsets.npy"))
    with (corpus / "tracks.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    out = []
    for row in rows:
        if row["split"] != split or row["tokens"] <= 0:
            continue
        body = np.asarray(
            tokens[int(offsets[row["track"]]):int(offsets[row["track"] + 1])],
            dtype=np.int64)
        cond = [int(c) for c in row.get("conditioning") or []]
        # strip the stored prefix; it is re-attached per window (with dropout)
        out.append({"body": body[1 + len(cond):], "cond": cond,
                    "system": row.get("system", "gb"),
                    # Paired representations have different token overhead.
                    # Source-event counts are invariant and therefore the fair
                    # unit for sampling them; older corpora fall back to tokens.
                    "events": row.get("events")})
    return [t for t in out if len(t["body"]) > 16]


def sample_units(track: dict) -> int:
    events = track.get("events")
    return int(events) if events is not None and int(events) > 0 \
        else len(track["body"])


def transpose(window: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    melodic = (window >= MELODIC_LOW) & (window < MELODIC_HIGH)
    if not melodic.any():
        return window
    rel = window[melodic] - MELODIC_LOW
    low = -min(5, int(rel.min()))
    high = min(6, PITCHES - 1 - int(rel.max()))
    if high < low:
        return window
    shift = int(rng.integers(low, high + 1))
    if shift:
        window = window.copy()
        window[melodic] += shift
    return window


def batch_from(stream: np.ndarray, batch: int, context: int,
               rng: np.random.Generator, augment: bool) -> torch.Tensor:
    starts = rng.integers(0, len(stream) - context - 1, size=batch)
    rows = []
    for s in starts:
        window = stream[int(s):int(s) + context + 1]
        if augment:
            window = transpose(window, rng)
        rows.append(window)
    return torch.from_numpy(np.stack(rows))


def batch_from_tracks(tracks: list[dict], batch: int, context: int,
                      rng: np.random.Generator, augment: bool,
                      nulls: list[int], drop: float) -> torch.Tensor:
    """One window per example, always carrying its style prefix.

    Each conditioning axis is independently replaced by its NULL token with
    probability `drop`. That is what teaches one model both the conditional and
    the unconditional distribution, so sampling can interpolate between them
    (classifier-free guidance) instead of only ever obeying the label.
    """
    weights = np.asarray([t.get("weight", sample_units(t)) for t in tracks],
                         dtype=np.float64)
    weights /= weights.sum()
    rows = []
    for _ in range(batch):
        track = tracks[int(rng.choice(len(tracks), p=weights))]
        cond = [nulls[i] if rng.random() < drop else c
                for i, c in enumerate(track["cond"])]
        prefix = np.asarray([BOS] + cond, dtype=np.int64)
        need = context + 1 - len(prefix)
        body = track["body"]
        if len(body) > need:
            # Always slicing at random means the model never learns how a song
            # BEGINS -- it only ever sees mid-song context after the prefix, so
            # at generation time it will not emit the opening section header.
            start = 0 if rng.random() < 0.25 else int(rng.integers(0, len(body) - need))
            window = body[start:start + need]
        else:
            window = body
        if augment:
            window = transpose(window, rng)
        row = np.concatenate([prefix, window])
        if len(row) < context + 1:                 # PAD; masked out of the loss
            row = np.concatenate(
                [row, np.zeros(context + 1 - len(row), dtype=np.int64)])
        rows.append(row)
    return torch.from_numpy(np.stack(rows))


@torch.no_grad()
def evaluate(model, stream, context: int, device,
             batches: int = 24, nulls=None) -> float:
    model.eval()
    rng = np.random.default_rng(0)
    total, count = 0.0, 0
    for _ in range(batches):
        if isinstance(stream, list):
            # held-out loss is measured with the TRUE labels (no dropout), so
            # the number tracks conditional quality rather than the mixture
            block = batch_from_tracks(stream, 8, context, rng, False,
                                      nulls or [], 0.0).to(device)
        else:
            block = batch_from(stream, 8, context, rng, augment=False).to(device)
        with torch.autocast("cuda", dtype=torch.bfloat16,
                            enabled=device.type == "cuda"):
            logits = model(block[:, :-1])
            loss = nn.functional.cross_entropy(
                logits.float().reshape(-1, logits.shape[-1]),
                block[:, 1:].reshape(-1), ignore_index=0)
        total += float(loss)
        count += 1
    model.train()
    return total / max(1, count)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--train-seconds", type=int, default=2700)
    parser.add_argument("--max-new-steps", type=int,
                        help="end this invocation after exactly this many new "
                             "steps while keeping --total-steps fixed")
    parser.add_argument("--progress-every", type=int, default=50)
    parser.add_argument("--checkpoint-every", type=int, default=500)
    parser.add_argument("--host-boot-id",
                        help="caller-supplied host boot identity for reboot detection")
    parser.add_argument("--total-steps", type=int, default=300000)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--context", type=int, default=2048)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--layers", type=int, default=10)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--warmup", type=int, default=2000)
    parser.add_argument("--cond-dropout", type=float, default=0.15,
                        help="per-axis probability of replacing a style token "
                             "with NULL, enabling classifier-free guidance")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--seed", type=int, default=20260812,
                        help="model, dropout, batch, and augmentation seed; use "
                             "the same value for controlled representation runs")
    parser.add_argument("--init-from", type=Path, default=None,
                        help="load model weights from this checkpoint but NOT "
                             "its optimizer state or step count: this is the "
                             "fine-tune entry point, a fresh schedule on "
                             "pretrained weights")
    parser.add_argument("--systems", default=None,
                        help="comma-separated systems to train on, e.g. 'gb'. "
                             "Restricting the mix turns this into the "
                             "specialization stage; balanced sampling is "
                             "skipped because there is nothing to balance")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device(
        args.device if torch.cuda.is_available() or args.device == "cpu"
        else "cpu")
    args.run_dir.mkdir(parents=True, exist_ok=True)
    config_path = args.run_dir / "config.json"
    if config_path.exists():
        config = load_config(config_path)
    else:
        vocab = json.loads(
            (args.corpus / "vocab.json").read_text(encoding="utf-8"))["vocab"]
        config = GbLmConfig(vocab=vocab, context=args.context,
                            width=args.width, layers=args.layers,
                            heads=args.heads, dropout=args.dropout)
        save_config(config_path, config)

    bind_vocab(args.corpus)
    vocab_meta = json.loads(
        (args.corpus / "vocab.json").read_text(encoding="utf-8"))
    receipt_path = args.corpus / "receipt.json"
    corpus_receipt = (json.loads(receipt_path.read_text(encoding="utf-8"))
                      if receipt_path.exists() else {})
    run_spec = {
        "schema": "chiptunes-lm-run-v1",
        "corpusSchema": vocab_meta.get("schema"),
        "ordering": vocab_meta.get("ordering"),
        "sourceEventSetSha256": corpus_receipt.get("sourceEventSetSha256"),
        "seed": args.seed,
        "systems": args.systems,
        "batchSize": args.batch_size,
        "context": config.context,
        "width": config.width,
        "layers": config.layers,
        "heads": config.heads,
        "learningRate": args.learning_rate,
        "warmup": args.warmup,
        "totalSteps": args.total_steps,
        "condDropout": args.cond_dropout,
        "host": platform.node(),
    }
    run_spec_path = args.run_dir / "run.json"
    if run_spec_path.exists():
        previous_spec = json.loads(run_spec_path.read_text(encoding="utf-8"))
        if previous_spec != run_spec:
            changed = sorted(key for key in set(previous_spec) | set(run_spec)
                             if previous_spec.get(key) != run_spec.get(key))
            raise SystemExit("run configuration changed on resume: %s" %
                             ", ".join(changed))
    else:
        run_spec_path.write_text(json.dumps(run_spec, indent=2, sort_keys=True)
                                 + "\n", encoding="utf-8")
    cond_layout = vocab_meta.get("conditioning") or {}
    nulls = [cond_layout[a]["null"] for a in
             ("game", "composer", "function", "system", "era")
             if a in cond_layout]
    if nulls:
        train = load_tracks(args.corpus, "train")
        validation = load_tracks(args.corpus, "validation")
        # System-balanced sampling: GB alone is 56% of tokens and NES 19%; left
        # raw, the pretrain majority-votes its way into two accents. Weight each
        # track so batch composition matches the target mix instead.
        # v8: the midi score cohort is 53% of raw tokens; cap it at .35 so the
        # chip idiom stays audible, and keep GB the anchor at .30.
        SYS_TARGET = {"midi": 0.35, "gb": 0.30, "nes": 0.12, "tracker": 0.10,
                      "hes": 0.05, "sms": 0.027, "gg": 0.027, "kss": 0.026}
        def sysof(t):
            s = t.get("system", "gb")
            return "gb" if s in ("dmg", "cgb") else s
        if args.systems:
            want = {s.strip() for s in args.systems.split(",") if s.strip()}
            train = [t for t in train if sysof(t) in want]
            if not train:
                raise SystemExit("--systems %r matched no training tracks"
                                 % args.systems)
            for t in train:
                t["weight"] = sample_units(t)
            validation = [t for t in validation if sysof(t) in want] or validation
            print(json.dumps({"specialized": sorted(want),
                              "trainTracks": len(train),
                              "valTracks": len(validation)},
                             sort_keys=True), flush=True)
        else:
            total = sum(sample_units(t) for t in train)
            share = {}
            for t in train:
                share[sysof(t)] = share.get(sysof(t), 0) + sample_units(t)
            for t in train:
                s_ = sysof(t)
                natural = share[s_] / total
                t["weight"] = sample_units(t) * (SYS_TARGET.get(s_, 0.02)
                                                  / max(1e-9, natural))
            # best.pt is selected on GB validation only: transfer to the
            # fine-tune target is the number that matters, not fluency on the
            # mixture.
            validation = [t for t in validation if sysof(t) == "gb"] or validation
            print(json.dumps({"balanced": True,
                          "batchMix": SYS_TARGET,
                          "gbValTracks": len(validation)}, sort_keys=True), flush=True)
        print(json.dumps({"conditioned": True, "trainTracks": len(train),
                          "valTracks": len(validation),
                          "axes": len(nulls)}, sort_keys=True), flush=True)
    else:
        train = load_split(args.corpus, "train")
        validation = load_split(args.corpus, "validation")
    model = GbLm(config).to(device)
    # Weight decay must NOT hit LayerNorm, biases, or the (tied) embedding —
    # decaying a tied embedding also shrinks the output projection, which drives
    # logit blow-ups. This is the standard GPT param grouping.
    decay, no_decay = [], []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if param.ndim < 2 or "tokens" in name or "positions" in name:
            no_decay.append(param)
        else:
            decay.append(param)
    optimizer = torch.optim.AdamW(
        [{"params": decay, "weight_decay": 0.01},
         {"params": no_decay, "weight_decay": 0.0}],
        lr=args.learning_rate, betas=(0.9, 0.95), eps=1e-8)
    step, best_val = 0, float("inf")
    latest = args.run_dir / "latest.pt"
    best = args.run_dir / "best.pt"
    lr_scale = 1.0
    rolled_back = False
    # A diverged run must never be resumed forever. If the last chunk ended far
    # worse than the best checkpoint, restart from best and halve the learning
    # rate — otherwise the loop happily burns GPU on wrecked weights (observed:
    # val 2.27 -> 13.9, train loss above ln(vocab), five hours wasted).
    def as_float(value, fallback: float) -> float:
        # A mid-chunk save stores lastVal=None, so `.get(key, default)` returns
        # None rather than the default. float(None) then throws and every resume
        # crashes at startup — the loop span an hour retrying with an idle GPU.
        try:
            return float(value) if value is not None else fallback
        except (TypeError, ValueError):
            return fallback

    if not latest.exists() and args.init_from:
        # Fine-tune entry: take the pretrained weights and nothing else. Loading
        # the optimizer state or step count would drop the run at the tail of
        # the pretrain LR schedule, and the specialization stage needs its own
        # warmup on a fresh, smaller LR.
        seed = torch.load(args.init_from, map_location="cpu")
        missing, unexpected = model.load_state_dict(seed["model"], strict=False)
        print(json.dumps({"initFrom": str(args.init_from),
                          "initStep": int(as_float(seed.get("step"), 0)),
                          "initBestVal": as_float(seed.get("bestVal"),
                                                  float("nan")),
                          "missingKeys": len(missing),
                          "unexpectedKeys": len(unexpected)},
                         sort_keys=True), flush=True)
        if missing or unexpected:
            raise SystemExit("checkpoint does not match this architecture: "
                             "%d missing, %d unexpected"
                             % (len(missing), len(unexpected)))
    if latest.exists():
        payload = torch.load(latest, map_location="cpu")
        best_val = as_float(payload.get("bestVal"), best_val)
        last_val = as_float(payload.get("lastVal"), float("nan"))
        lr_scale = as_float(payload.get("lrScale"), 1.0)
        step = int(as_float(payload.get("step"), 0))
        diverged = (
            math.isfinite(best_val)
            and (not math.isfinite(last_val) or last_val > best_val * 1.4)
        )
        if diverged and best.exists():
            recovered = torch.load(best, map_location="cpu")
            model.load_state_dict(recovered["model"])
            lr_scale = max(0.05, lr_scale * 0.5)
            rolled_back = True
        else:
            model.load_state_dict(payload["model"])
            try:
                optimizer.load_state_dict(payload["optimizer"])
            except (ValueError, KeyError):
                pass

    initial_loss = None
    if step == 0 and not args.init_from:
        initial_loss = evaluate(model, validation, config.context, device,
                                batches=2, nulls=nulls)
        uniform_loss = math.log(config.vocab)
        check = {"initialLoss": round(initial_loss, 5),
                 "uniformLoss": round(uniform_loss, 5),
                 "difference": round(initial_loss - uniform_loss, 5)}
        print(json.dumps(check, sort_keys=True), flush=True)
        if abs(initial_loss - uniform_loss) > 0.25:
            raise RuntimeError("untrained loss is not approximately ln(vocab): "
                               + json.dumps(check, sort_keys=True))

    base_lr = args.learning_rate * lr_scale
    invocation_start_step = step
    checkpoint_step = step if latest.exists() else 0

    def write_progress() -> None:
        elapsed = max(time.time() - started, 0.001)
        advanced = max(0, step - invocation_start_step)
        steps_per_hour = advanced * 3600.0 / elapsed
        samples_per_hour = steps_per_hour * args.batch_size
        tokens_per_second = (advanced * args.batch_size * config.context
                             / elapsed)
        remaining = max(0, args.total_steps - step)
        payload = {
            "schema": "chiptunes-training-progress-v2",
            "pid": os.getpid(),
            "host": platform.node(),
            "hostBootId": args.host_boot_id,
            "step": step,
            "totalSteps": args.total_steps,
            "checkpointStep": checkpoint_step,
            "recentLoss": round(float(np.mean(losses[-200:])), 5)
                          if losses else None,
            "minLoss": round(float(np.min(losses)), 5) if losses else None,
            "lr": round(lr_at(step), 9),
            "skippedSpikes": skipped_spikes,
            "elapsedSeconds": round(elapsed, 1),
            "tokensPerSecond": round(tokens_per_second, 2)
                               if advanced else None,
            "stepsPerHour": round(steps_per_hour, 2) if advanced else None,
            "samplesPerHour": round(samples_per_hour, 2) if advanced else None,
            "etaSeconds": round(remaining * 3600.0 / steps_per_hour)
                          if steps_per_hour else None,
            "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        path = args.run_dir / "progress.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, sort_keys=True) + "\n",
                             encoding="utf-8")
        os.replace(temporary, path)
    # A normal chunk resume continues the one global LR schedule.  Restarting
    # warmup on every attended three-hour invocation made the schedule depend
    # on wall-clock chunking.  Only a genuine divergence rollback re-warms the
    # recovered checkpoint at its reduced learning rate.
    warm_from = step if rolled_back else 0

    def lr_at(s: int) -> float:
        local = s - warm_from
        if local < args.warmup:
            return base_lr * (local + 1) / args.warmup
        progress = min(1.0, (s - args.warmup) /
                       max(1, args.total_steps - args.warmup))
        return base_lr * (0.03 + 0.97 * 0.5 *
                          (1 + math.cos(math.pi * progress)))

    rng = np.random.default_rng(args.seed + step)
    started = time.time()
    losses = []
    diverged_midchunk = False
    high_skip_rate = None
    skipped_spikes = 0
    observed: list[float] = []
    model.train()
    write_progress()
    while (time.time() - started < args.train_seconds
           and step < args.total_steps
           and (args.max_new_steps is None
                or step - invocation_start_step < args.max_new_steps)):
        for group in optimizer.param_groups:
            group["lr"] = lr_at(step)
        if nulls:
            block = batch_from_tracks(train, args.batch_size, config.context,
                                      rng, True, nulls, args.cond_dropout
                                      ).to(device, non_blocking=True)
        else:
            block = batch_from(train, args.batch_size, config.context, rng,
                               augment=True).to(device, non_blocking=True)
        with torch.autocast("cuda", dtype=torch.bfloat16,
                            enabled=device.type == "cuda"):
            logits = model(block[:, :-1])
            # fp32 for the loss: bf16 logits lose meaningful precision here.
            loss = nn.functional.cross_entropy(
                logits.float().reshape(-1, logits.shape[-1]),
                block[:, 1:].reshape(-1), ignore_index=0)
        value = float(loss.detach())
        if not math.isfinite(value):
            raise RuntimeError(f"non-finite loss at step {step}")
        # Spike protection: a single pathological window can produce a gradient
        # that wrecks the run. Skip the step instead of learning from it.
        #
        # The threshold MUST come from every observed loss, not only accepted
        # ones. Taking the median over accepted losses is a ratchet: each
        # accepted low loss tightens the bar, which rejects more batches, which
        # lowers the median again. That starved training at ~88% skipped while
        # still paying for the forward pass.
        observed.append(value)
        recent_median = (float(np.median(observed[-400:]))
                         if len(observed) >= 100 else None)
        if recent_median is not None and value > max(2.0, recent_median * 4.0):
            skipped_spikes += 1
            optimizer.zero_grad(set_to_none=True)
            step += 1
            if step % args.progress_every == 0:
                write_progress()
            continue
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        grad_norm = float(nn.utils.clip_grad_norm_(model.parameters(), 1.0))
        if not math.isfinite(grad_norm):
            skipped_spikes += 1
            optimizer.zero_grad(set_to_none=True)
            step += 1
            if step % args.progress_every == 0:
                write_progress()
            continue
        optimizer.step()
        losses.append(value)
        step += 1
        # Uniform loss is ln(vocab); sustained loss above it means the model is
        # confidently wrong. Abort the chunk immediately so the next pass rolls
        # back, instead of training deeper into a diverged basin.
        if step % 200 == 0 and len(observed) >= 400:
            rate = skipped_spikes / max(1, len(observed))
            if rate > 0.35:
                high_skip_rate = round(rate, 4)
                write_progress()
                break
        if len(losses) >= 120 and step % 60 == 0:
            recent = float(np.mean(losses[-120:]))
            if recent > math.log(config.vocab) * 1.15:
                diverged_midchunk = True
                write_progress()
                break
        if step % args.checkpoint_every == 0:
            torch.save({"model": model.state_dict(),
                        "optimizer": optimizer.state_dict(),
                        "step": step, "bestVal": best_val,
                        "lastVal": None, "lrScale": lr_scale,
                        "config": config.__dict__}, latest)
            checkpoint_step = step
        if step % args.progress_every == 0:
            write_progress()

    val = evaluate(model, validation, config.context, device, nulls=nulls)
    improved = val < best_val
    if improved:
        best_val = val
        torch.save({"model": model.state_dict(), "step": step,
                    "bestVal": best_val, "config": config.__dict__},
                   args.run_dir / "best.pt")
    torch.save({"model": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "step": step, "bestVal": best_val,
                "lastVal": val, "lrScale": lr_scale,
                "config": config.__dict__}, latest)
    checkpoint_step = step
    write_progress()

    record = {
        "step": step,
        "trainLoss": round(float(np.mean(losses[-200:])), 5) if losses else None,
        "valLoss": round(val, 5),
        "bestVal": round(best_val, 5),
        "improved": improved,
        "rolledBack": rolled_back,
        "divergedMidChunk": diverged_midchunk,
        "skippedSpikes": skipped_spikes,
        "observedSteps": len(observed),
        "skipRate": round(skipped_spikes / max(1, len(observed)), 4),
        "highSkipRate": high_skip_rate,
        "lrScale": round(lr_scale, 4),
        "baseLr": round(base_lr, 8),
        "seed": args.seed,
        "initialLoss": round(initial_loss, 5) if initial_loss is not None else None,
        "tokensPerSecond": round(
            len(losses) * args.batch_size * config.context /
            max(1.0, time.time() - started)),
        "finishedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": platform.node(),
        "hostBootId": args.host_boot_id,
    }
    with (args.run_dir / "history.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")
    print(json.dumps(record, sort_keys=True))


if __name__ == "__main__":
    main()
