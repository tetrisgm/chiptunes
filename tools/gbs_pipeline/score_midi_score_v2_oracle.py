"""Score the preregistered score-v2 preservation listening oracle."""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
from typing import Any


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _last_verdicts(path: Path) -> dict[str, str]:
    values = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            choice = row.get("grade", row.get("choice"))
            if choice in {"a", "b", "tie"}:
                values[row.get("id", row.get("file"))] = choice
    return values


def _one_sided_original_p(original: int, roundtrip: int) -> float | None:
    trials = original + roundtrip
    if not trials:
        return None
    return sum(math.comb(trials, value) for value in range(original, trials + 1)) \
        / (2 ** trials)


def score_oracle(batch: Path, owner_observation: str) -> dict[str, Any]:
    if owner_observation not in {"no-repeated-loss", "repeated-loss"}:
        raise ValueError("owner observation must be explicit")
    key_path = batch / "key.json"
    receipt_path = batch / "receipt.json"
    verdict_path = batch / "verdicts.jsonl"
    key = json.loads(key_path.read_text(encoding="utf-8"))
    render = json.loads(receipt_path.read_text(encoding="utf-8"))
    verdicts = _last_verdicts(verdict_path)
    missing = sorted(set(key) - set(verdicts))
    if missing:
        raise ValueError(f"oracle review is incomplete: {len(missing)} missing")

    semantic = {}
    for pair_id, metadata in key.items():
        choice = verdicts[pair_id]
        semantic[pair_id] = "tie" if choice == "tie" else metadata[choice]
    unique_ids = [pair_id for pair_id, metadata in key.items()
                  if not metadata["repeat"]]
    repeat_ids = [pair_id for pair_id, metadata in key.items()
                  if metadata["repeat"]]
    unique_counts = collections.Counter(semantic[pair_id] for pair_id in unique_ids)
    by_category: dict[str, collections.Counter[str]] = collections.defaultdict(
        collections.Counter)
    for pair_id in unique_ids:
        by_category[key[pair_id]["category"]][semantic[pair_id]] += 1
    repeat_rows = []
    for pair_id in repeat_ids:
        original_id = key[pair_id]["repeatOf"]
        repeat_rows.append({
            "id": pair_id, "repeatOf": original_id,
            "first": semantic[original_id], "repeat": semantic[pair_id],
            "agrees": semantic[original_id] == semantic[pair_id],
        })
    repeat_agreement = sum(row["agrees"] for row in repeat_rows)
    original_wins = unique_counts["original"]
    per_category_passed = all(
        counts["original"] <= 2 for counts in by_category.values())
    conditions = {
        "renderedThirty": render.get("uniqueSongs") == 30,
        "reviewComplete": len(unique_ids) == 30 and len(repeat_ids) == 6,
        "originalPreferenceAtMostSix": original_wins <= 6,
        "originalPreferenceAtMostTwoPerStratum": per_category_passed,
        "repeatAgreementAtLeastFiveOfSix": repeat_agreement >= 5,
        "ownerReportsNoRepeatedAudibleLoss":
            owner_observation == "no-repeated-loss",
    }
    result = {
        "schema": "chiptunes-midi-score-v2-oracle-verdict-v1",
        "batch": batch.name,
        "receiptSha256": _sha256(receipt_path),
        "keySha256": _sha256(key_path),
        "verdictsSha256": _sha256(verdict_path),
        "unique": {
            "songs": len(unique_ids),
            "preferences": {key: unique_counts[key]
                            for key in ("original", "roundtrip", "tie")},
            "oneSidedOriginalPreferenceP": _one_sided_original_p(
                unique_counts["original"], unique_counts["roundtrip"]),
            "byCategory": {
                category: {key: counts[key]
                           for key in ("original", "roundtrip", "tie")}
                for category, counts in sorted(by_category.items())
            },
        },
        "repeats": {
            "pairs": len(repeat_rows),
            "agreements": repeat_agreement,
            "required": 5,
            "rows": repeat_rows,
        },
        "ownerObservation": owner_observation,
        "conditions": conditions,
        "passed": all(conditions.values()),
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("batch", type=Path)
    parser.add_argument("--owner-observation", required=True,
                        choices=("no-repeated-loss", "repeated-loss"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = score_oracle(args.batch, args.owner_observation)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items()
                      if key != "repeats"}, sort_keys=True))


if __name__ == "__main__":
    main()
