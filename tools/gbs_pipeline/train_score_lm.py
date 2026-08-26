"""Bounded, instrumented training checks for the MIDI-v2 ScoreLM.

This runner deliberately has no unattended mode.  Each invocation has an
explicit step limit and writes a receipt only after the requested work ends.
It is used for the 32-score overfit and 100-step throughput checks before any
corpus-scale training is authorized.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch

from midi_score_v2 import read_score
from score_lm import EVENT_FIELDS, ScoreLm, ScoreLmConfig
from tokenize_score_v2 import encode_score


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _event_tensor(score: dict[str, Any]) -> torch.Tensor:
    compound = encode_score(score)
    return torch.tensor(
        [[int(event[field]) for field in EVENT_FIELDS]
         for event in compound["events"]], dtype=torch.long)


def _kept_rows(manifest: Path, split: str = "train") -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    families_path = manifest.parent / "families.jsonl"
    families = {
        row["relativePath"]: row for row in
        (json.loads(line) for line in families_path.read_text(encoding="utf-8").splitlines()
         if line.strip())
    }
    return [row for row in rows
            if row.get("status") == "kept"
            and families[row["relativePath"]]["split"] == split]


def _select_rows(rows: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    if len(rows) < count:
        raise ValueError(f"need {count} eligible scores, found {len(rows)}")
    # Evenly sample the sorted family-safe training population, rather than
    # taking adjacent files from one source directory.
    indexes = np.linspace(0, len(rows) - 1, count, dtype=int)
    return [rows[int(index)] for index in indexes]


def _load_tracks(build: Path, rows: list[dict[str, Any]]) -> list[torch.Tensor]:
    tracks = []
    for row in rows:
        events = _event_tensor(read_score(build / row["scorePath"]))
        if len(events) > 2:
            tracks.append(events)
    if not tracks:
        raise ValueError("selected scores contain no trainable events")
    return tracks


def _window(track: torch.Tensor, context: int,
            rng: np.random.Generator) -> torch.Tensor:
    width = min(context + 1, len(track))
    if len(track) > width:
        start = int(rng.integers(0, len(track) - width + 1))
        window = track[start:start + width]
    else:
        window = track
    if len(window) < context + 1:
        padding = torch.zeros((context + 1 - len(window), track.shape[1]),
                              dtype=torch.long)
        window = torch.cat((window, padding), dim=0)
    return window


def _batch(tracks: list[torch.Tensor], batch: int, context: int,
           rng: np.random.Generator) -> tuple[torch.Tensor, torch.Tensor]:
    inputs, targets = [], []
    for _ in range(batch):
        track = tracks[int(rng.integers(0, len(tracks)))]
        window = _window(track, context, rng)
        inputs.append(window[:-1])
        targets.append(window[1:])
    return torch.stack(inputs), torch.stack(targets)


def _config(args: argparse.Namespace) -> ScoreLmConfig:
    return ScoreLmConfig(context=args.context, width=args.width,
                         layers=args.layers, heads=args.heads,
                         dropout=args.dropout)


def _atomic_torch_save(payload: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, temporary)
    temporary.replace(path)


def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.init_from is not None and args.resume_from is not None:
        raise ValueError("--init-from and --resume-from are mutually exclusive")
    torch.manual_seed(args.seed)
    np_rng = np.random.default_rng(args.seed)
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but torch.cuda.is_available() is false")
    rows = _kept_rows(args.manifest)
    selected = rows if args.mode == "epoch" else _select_rows(rows, args.scores)
    tracks = [] if args.mode == "epoch" else _load_tracks(args.build, selected)
    config = _config(args)
    model = ScoreLm(config).to(device)
    output = args.output
    if args.init_from is not None:
        checkpoint = torch.load(args.init_from, map_location=device,
                                weights_only=False)
        model.load_state_dict(checkpoint["model"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    initial_loss = None
    minimum_loss = float("inf")
    losses: list[float] = []
    progress_path = args.output.with_suffix(".progress.json")
    order = np.arange(len(selected), dtype=np.int64)
    np_rng.shuffle(order)
    cursor = 0
    touched: set[int] = set()
    start_step = 0
    elapsed_offset = 0.0
    if args.resume_from is not None:
        checkpoint = torch.load(args.resume_from, map_location=device,
                                weights_only=False)
        if checkpoint.get("schema") != \
                "chiptunes-midi-score-v2-training-checkpoint-v1":
            raise ValueError("resume checkpoint has an unknown schema")
        expected = {
            "mode": args.mode, "stepsTarget": args.steps,
            "batchSize": args.batch_size, "context": args.context,
            "width": args.width, "layers": args.layers, "heads": args.heads,
            "dropout": args.dropout, "learningRate": args.learning_rate,
            "seed": args.seed, "manifestSha256": _sha256(args.manifest),
        }
        if checkpoint.get("run") != expected:
            raise ValueError("resume checkpoint run configuration changed")
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        np_rng.bit_generator.state = checkpoint["numpyRngState"]
        torch.random.set_rng_state(checkpoint["torchRngState"].cpu())
        if device.type == "cuda" and checkpoint.get("cudaRngStateAll"):
            torch.cuda.set_rng_state_all(checkpoint["cudaRngStateAll"])
        order = np.asarray(checkpoint["order"], dtype=np.int64)
        cursor = int(checkpoint["cursor"])
        touched = {int(value) for value in checkpoint["touched"]}
        start_step = int(checkpoint["step"])
        initial_loss = float(checkpoint["initialLoss"])
        minimum_loss = float(checkpoint["minimumLoss"])
        elapsed_offset = float(checkpoint["elapsedSeconds"])
        if not 0 <= start_step < args.steps:
            raise ValueError("resume checkpoint step is outside the requested run")
    model.train()
    started = time.perf_counter()
    run_config = {
        "mode": args.mode, "stepsTarget": args.steps,
        "batchSize": args.batch_size, "context": args.context,
        "width": args.width, "layers": args.layers, "heads": args.heads,
        "dropout": args.dropout, "learningRate": args.learning_rate,
        "seed": args.seed, "manifestSha256": _sha256(args.manifest),
    }
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    for step in range(start_step + 1, args.steps + 1):
        if args.mode == "epoch":
            batch_tracks = []
            for _ in range(args.batch_size):
                if cursor >= len(order):
                    np_rng.shuffle(order)
                    cursor = 0
                index = int(order[cursor])
                cursor += 1
                touched.add(index)
                batch_tracks.append(_event_tensor(
                    read_score(args.build / selected[index]["scorePath"])))
            events, targets = _batch(batch_tracks, args.batch_size,
                                     args.context, np_rng)
        else:
            events, targets = _batch(tracks, args.batch_size, args.context, np_rng)
        events, targets = events.to(device), targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type,
                            dtype=torch.bfloat16,
                            enabled=device.type == "cuda"):
            loss, _ = model.loss(events, targets)
        if not torch.isfinite(loss):
            raise RuntimeError(f"non-finite loss at step {step}: {loss}")
        if initial_loss is None:
            initial_loss = float(loss.detach())
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        losses.append(float(loss.detach()))
        minimum_loss = min(minimum_loss, losses[-1])
        if args.checkpoint_every and step % args.checkpoint_every == 0:
            elapsed = elapsed_offset + time.perf_counter() - started
            _atomic_torch_save({
                "schema": "chiptunes-midi-score-v2-training-checkpoint-v1",
                "model": model.state_dict(), "optimizer": optimizer.state_dict(),
                "config": config.__dict__, "run": run_config, "step": step,
                "numpyRngState": np_rng.bit_generator.state,
                "torchRngState": torch.random.get_rng_state(),
                "cudaRngStateAll": (torch.cuda.get_rng_state_all()
                                    if device.type == "cuda" else None),
                "order": order.tolist(), "cursor": cursor,
                "touched": sorted(touched), "initialLoss": initial_loss,
                "minimumLoss": minimum_loss, "elapsedSeconds": elapsed,
            }, output.with_suffix(".latest.pt"))
        if step == 1 or step % args.progress_every == 0 or step == args.steps:
            elapsed = elapsed_offset + time.perf_counter() - started
            progress_path.parent.mkdir(parents=True, exist_ok=True)
            progress_path.write_text(json.dumps({
                "schema": "chiptunes-midi-score-v2-training-progress-v1",
                "mode": args.mode,
                "updatedUtc": datetime.now(timezone.utc).isoformat(),
                "step": step,
                "stepsTarget": args.steps,
                "fraction": round(step / args.steps, 8),
                "loss": losses[-1],
                "elapsedSeconds": round(elapsed, 3),
                "stepsPerSecond": round(step / max(elapsed, 1e-9), 6),
            }, sort_keys=True) + "\n", encoding="utf-8")
    elapsed = elapsed_offset + time.perf_counter() - started
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": model.state_dict(), "config": config.__dict__,
                "step": args.steps}, output.with_suffix(".pt"))
    events_selected = (sum(int(row["compound"]["events"]) for row in selected)
                       if args.mode == "epoch"
                       else sum(len(track) for track in tracks))
    result = {
        "schema": "chiptunes-midi-score-v2-training-check-v1",
        "mode": args.mode,
        "seed": args.seed,
        "device": str(device),
        "torch": torch.__version__,
        "cuda": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
        "scoresEligible": len(rows),
        "scoresSelected": len(touched) if args.mode == "epoch" else len(tracks),
        "eventsSelected": events_selected,
        "steps": args.steps,
        "batchSize": args.batch_size,
        "context": args.context,
        "model": {"width": args.width, "layers": args.layers,
                  "heads": args.heads, "parameters": sum(
                      parameter.numel() for parameter in model.parameters())},
        "initialLoss": initial_loss,
        "finalLoss": losses[-1],
        "minimumLoss": minimum_loss,
        "lossFinite": all(math.isfinite(value) for value in losses),
        "lossImproved": losses[-1] < (initial_loss or float("inf")),
        "elapsedSeconds": round(elapsed, 3),
        "stepsPerSecond": round(args.steps / max(elapsed, 1e-9), 6),
        "eventsPerSecond": round(args.steps * args.batch_size * args.context
                                  / max(elapsed, 1e-9), 3),
        "peakGpuBytes": (torch.cuda.max_memory_allocated(device)
                         if device.type == "cuda" else None),
        "manifestSha256": _sha256(args.manifest),
    }
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("overfit", "benchmark", "epoch"), required=True)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scores", type=int, default=32)
    parser.add_argument("--steps", type=int, required=True)
    parser.add_argument("--context", type=int, default=512)
    parser.add_argument("--width", type=int, default=256)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--dropout", type=float, default=0.0)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=20260815)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--progress-every", type=int, default=50)
    parser.add_argument("--checkpoint-every", type=int, default=5000)
    parser.add_argument("--init-from", type=Path, default=None)
    parser.add_argument("--resume-from", type=Path, default=None)
    _run(parser.parse_args())


if __name__ == "__main__":
    main()
