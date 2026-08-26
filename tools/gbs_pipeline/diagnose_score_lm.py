"""Teacher-forced diagnostics for a bounded ScoreLM checkpoint."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from midi_score_v2 import read_score
from score_lm import EVENT_FIELDS, ScoreLm, ScoreLmConfig, field_active_mask
from tokenize_score_v2 import encode_score


def rows_for(manifest: Path, families: Path, split: str, count: int):
    rows = [json.loads(line) for line in manifest.read_text().splitlines()
            if line.strip()]
    split_map = {json.loads(line)["relativePath"]: json.loads(line)["split"]
                 for line in families.read_text().splitlines() if line.strip()}
    eligible = [row for row in rows if row.get("status") == "kept"
                and split_map[row["relativePath"]] == split]
    indexes = np.linspace(0, len(eligible) - 1, min(count, len(eligible)), dtype=int)
    return [eligible[int(index)] for index in indexes]


def events_for(build: Path, row) -> torch.Tensor:
    score = read_score(build / row["scorePath"])
    compound = encode_score(score)
    return torch.tensor([[event[field] for field in EVENT_FIELDS]
                         for event in compound["events"]], dtype=torch.long)


@torch.no_grad()
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--build", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--families", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--count", type=int, default=8)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()
    device = torch.device(args.device)
    payload = torch.load(args.checkpoint, map_location=device, weights_only=False)
    config = ScoreLmConfig(**payload["config"])
    model = ScoreLm(config).to(device)
    model.load_state_dict(payload["model"])
    model.eval()
    rows = rows_for(args.manifest, args.families, "validation", args.count)
    totals = {field: [0, 0] for field in EVENT_FIELDS}
    losses = []
    for row in rows:
        sequence = events_for(args.build, row)
        sequence = sequence[:config.context + 1]
        inputs, targets = sequence[:-1].unsqueeze(0).to(device), sequence[1:].unsqueeze(0).to(device)
        loss, _ = model.loss(inputs, targets)
        losses.append(float(loss))
        logits = model(inputs)
        kinds = targets[..., EVENT_FIELDS.index("kind")]
        for field in EVENT_FIELDS:
            mask = field_active_mask(kinds, field)
            if not mask.any():
                continue
            prediction = logits[field].argmax(-1)
            totals[field][0] += int((prediction[mask] == targets[..., EVENT_FIELDS.index(field)][mask]).sum())
            totals[field][1] += int(mask.sum())
    result = {
        "schema": "chiptunes-midi-score-v2-teacher-forced-diagnostic-v1",
        "checkpoint": str(args.checkpoint), "split": "validation",
        "scores": len(rows), "meanLoss": sum(losses) / max(1, len(losses)),
        "fields": {field: {"correct": values[0], "total": values[1],
                            "accuracy": values[0] / values[1] if values[1] else None}
                   for field, values in totals.items()},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
