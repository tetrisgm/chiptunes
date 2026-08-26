"""Generate bounded neutral MIDI samples from a ScoreLM checkpoint."""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import torch

from score_lm import EVENT_FIELDS, ScoreLm, ScoreLmConfig
from tokenize_score_v2 import EVENT_KINDS


def vlq(value: int) -> bytes:
    value = max(0, min(0x0FFFFFFF, int(value)))
    out = [value & 127]
    value >>= 7
    while value:
        out.append(128 | (value & 127))
        value >>= 7
    return bytes(reversed(out))


def midi_from_events(events: list[list[int]]) -> bytes:
    ix = {name: EVENT_FIELDS.index(name) for name in EVENT_FIELDS}
    ticks: list[tuple[int, bytes]] = []
    q = 0
    meter_num, meter_den = 4, 2
    for row in events:
        kind = row[ix["kind"]]
        if kind == EVENT_KINDS["EOS"]:
            break
        beat_len = 384 // (1 << meter_den)
        q = max(q, row[ix["barDelta"]] * meter_num * beat_len
                + row[ix["beat"]] * beat_len + row[ix["position"]])
        if kind == EVENT_KINDS["METER"]:
            meter_num = max(1, min(12, row[ix["meterNumerator"]]))
            meter_den = max(0, min(7, row[ix["meterDenominatorPower"]]))
        elif kind == EVENT_KINDS["NOTE"]:
            pitch = max(0, min(127, row[ix["pitch"]]))
            velocity = max(1, min(127, row[ix["velocity"]]))
            duration = (row[ix["duration2"]] * 128 * 128
                        + row[ix["duration1"]] * 128
                        + row[ix["duration0"]])
            duration = max(1, min(0x0FFFFFFF, duration))
            channel = max(0, min(15, row[ix["part"]] - 1))
            ticks.append((q, bytes((0x90 | channel, pitch, velocity))))
            ticks.append((q + duration, bytes((0x80 | channel, pitch, 0))))
        q += 1
    ticks.sort(key=lambda item: item[0])
    body = bytearray()
    previous = 0
    for tick, payload in ticks:
        body.extend(vlq(tick - previous))
        body.extend(payload)
        previous = tick
    body.extend(vlq(0) + b"\xff\x2f\x00")
    track = b"MTrk" + len(body).to_bytes(4, "big") + body
    header = b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x00\x60"
    return header + track


def sample(logits: torch.Tensor, temperature: float, top_k: int,
           generator: torch.Generator) -> int:
    logits = logits.float() / max(temperature, 1e-4)
    if top_k and top_k < logits.numel():
        values, indices = torch.topk(logits, top_k)
        choice = torch.multinomial(torch.softmax(values, 0), 1,
                                   generator=generator)
        return int(indices[choice])
    return int(torch.multinomial(torch.softmax(logits, 0), 1,
                                 generator=generator))


@torch.no_grad()
def generate(model: ScoreLm, config: ScoreLmConfig, seed: int,
             device: torch.device, events_count: int, temperature: float,
             top_k: int) -> list[list[int]]:
    rng = torch.Generator(device=device).manual_seed(seed)
    ix = {name: EVENT_FIELDS.index(name) for name in EVENT_FIELDS}
    bos = [0] * len(EVENT_FIELDS)
    bos[ix["kind"]] = EVENT_KINDS["BOS"]
    sequence = [bos]
    for _ in range(events_count):
        context = torch.tensor([sequence[-config.context:]], dtype=torch.long,
                               device=device)
        logits = model(context)
        fields: list[int] = [0] * len(EVENT_FIELDS)
        kind_logits = logits["kind"][0, -1].clone()
        kind_logits[0] = float("-inf")
        kind_logits[EVENT_KINDS["BOS"]] = float("-inf")
        kind = sample(kind_logits, temperature, top_k, rng)
        fields[ix["kind"]] = kind
        for name in EVENT_FIELDS:
            if name == "kind":
                continue
            values = logits[name][0, -1]
            fields[ix[name]] = sample(values, temperature, top_k, rng)
        if kind == EVENT_KINDS["EOS"]:
            sequence.append(fields)
            break
        sequence.append(fields)
    if sequence[-1][ix["kind"]] != EVENT_KINDS["EOS"]:
        row = [0] * len(EVENT_FIELDS)
        row[ix["kind"]] = EVENT_KINDS["EOS"]
        sequence.append(row)
    return sequence


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--count", type=int, default=12)
    ap.add_argument("--events", type=int, default=256)
    ap.add_argument("--seed", type=int, default=20260815)
    ap.add_argument("--temperature", type=float, default=0.9)
    ap.add_argument("--top-k", type=int, default=12)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()
    device = torch.device(args.device)
    payload = torch.load(args.checkpoint, map_location=device, weights_only=False)
    config = ScoreLmConfig(**payload["config"])
    model = ScoreLm(config).to(device)
    model.load_state_dict(payload["model"])
    model.eval()
    args.output.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for index in range(args.count):
        song = f"generated-{index + 1:02d}.mid"
        events = generate(model, config, args.seed + index, device,
                          args.events, args.temperature, args.top_k)
        path = args.output / song
        path.write_bytes(midi_from_events(events))
        rows.append({"song": song, "seed": args.seed + index,
                     "events": len(events), "bytes": path.stat().st_size})
    receipt = {"schema": "chiptunes-midi-score-v2-generation-v1",
               "checkpoint": str(args.checkpoint), "count": len(rows),
               "temperature": args.temperature, "topK": args.top_k,
               "eventsRequested": args.events, "songs": rows}
    (args.output / "receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
