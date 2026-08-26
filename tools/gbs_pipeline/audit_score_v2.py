"""Deduplication and family-safe split primitives for score-v2 corpora.

The old corpora split rows before they knew which rows contained the same
music. This module reverses that order: byte-identical, exact canonical, and
tempo/transposition-normalized scores are unioned first, followed by a
conservative structural near-match pass. Only complete families receive a
split.
"""
from __future__ import annotations

import argparse
import bisect
import collections
import hashlib
import json
from fractions import Fraction
from pathlib import Path
from typing import Any, Sequence

from midi_score_v2 import read_score


FINGERPRINT_SCHEMA = "chiptunes-score-v2-fingerprints-v1"
SPLIT_RATIOS = (("validation", 500), ("test", 1000), ("train", 10_000))
_MINHASH_BUCKETS = 64
_MIN_NEAR_NOTES = 24
_MIN_SIGNATURE_AGREEMENT = 0.70
_MIN_SIZE_RATIO = 0.70


def _round_fraction(value: Fraction) -> int:
    if value < 0:
        raise ValueError("score time cannot be negative")
    return (value.numerator * 2 + value.denominator) // (2 * value.denominator)


class ScoreTimeMap:
    """Convert between source ticks, musical quarters, and playback time."""

    def __init__(self, score: dict[str, Any]):
        self.division = score["division"]
        self._ticks: list[int] = [0]
        self._quarters: list[Fraction] = [Fraction(0)]
        self._tempos: list[int] = [500_000]
        effective: dict[int, int] = {}
        for row in sorted(score["tempos"], key=lambda item: (
                item["tick"], item["track"], item.get("order", 0))):
            effective[row["tick"]] = row["microsecondsPerQuarter"]
        self._playback_ticks: list[int] = [0]
        self._playback_microseconds: list[Fraction] = [Fraction(0)]
        self._playback_tempos: list[int] = [500_000]
        tick = 0
        playback_us = Fraction(0)
        tempo = 500_000
        quarter = Fraction(0)
        for next_tick, next_tempo in sorted(effective.items()):
            if next_tick > tick:
                playback_us += self._tick_delta_microseconds(
                    next_tick - tick, tempo)
                self._playback_ticks.append(next_tick)
                self._playback_microseconds.append(playback_us)
                self._playback_tempos.append(next_tempo)
                if self.division["type"] == "smpte":
                    quarter += self._smpte_microseconds(next_tick - tick) / tempo
                    self._ticks.append(next_tick)
                    self._quarters.append(quarter)
                    self._tempos.append(next_tempo)
            else:
                self._playback_tempos[-1] = next_tempo
                if self.division["type"] == "smpte":
                    self._tempos[-1] = next_tempo
            tick = next_tick
            tempo = next_tempo

    def _smpte_microseconds(self, ticks: int | Fraction) -> Fraction:
        return Fraction(
            ticks * 1_000_000
            * self.division["framesPerSecondDenominator"],
            self.division["framesPerSecondNumerator"]
            * self.division["ticksPerFrame"])

    def _tick_delta_microseconds(self, ticks: int | Fraction,
                                 tempo: int) -> Fraction:
        if self.division["type"] == "smpte":
            return self._smpte_microseconds(ticks)
        return Fraction(ticks * tempo, self.division["ticksPerQuarter"])

    def quarters(self, tick: int) -> Fraction:
        if tick < 0:
            raise ValueError("score tick cannot be negative")
        if self.division["type"] == "ppq":
            return Fraction(tick, self.division["ticksPerQuarter"])
        index = bisect.bisect_right(self._ticks, tick) - 1
        return (self._quarters[index]
                + self._smpte_microseconds(tick - self._ticks[index])
                / self._tempos[index])

    def q96(self, tick: int) -> int:
        return _round_fraction(self.quarters(tick) * 96)

    def tick_at_quarters(self, quarters: Fraction) -> Fraction:
        if quarters < 0:
            raise ValueError("score time cannot be negative")
        if self.division["type"] == "ppq":
            return quarters * self.division["ticksPerQuarter"]
        index = bisect.bisect_right(self._quarters, quarters) - 1
        delta_us = (quarters - self._quarters[index]) * self._tempos[index]
        ticks_per_us = Fraction(
            self.division["framesPerSecondNumerator"]
            * self.division["ticksPerFrame"],
            1_000_000 * self.division["framesPerSecondDenominator"])
        return self._ticks[index] + delta_us * ticks_per_us

    def microseconds(self, tick: int | Fraction) -> Fraction:
        if tick < 0:
            raise ValueError("score tick cannot be negative")
        if self.division["type"] == "smpte":
            return self._smpte_microseconds(tick)
        index = bisect.bisect_right(self._playback_ticks, tick) - 1
        return (self._playback_microseconds[index]
                + self._tick_delta_microseconds(
                    tick - self._playback_ticks[index],
                    self._playback_tempos[index]))

    def microseconds_at_q96(self, q96: int) -> Fraction:
        return self.microseconds(self.tick_at_quarters(Fraction(q96, 96)))


def normalized_note_rows(score: dict[str, Any]) -> tuple[tuple[int, ...], ...]:
    """Return a tempo-, pickup-, track-, program-, and transpose-free score."""
    time_map = ScoreTimeMap(score)
    notes = sorted(score["notes"], key=lambda row: (
        row["start"], row["track"], row.get("port", 0), row["channel"],
        row["pitch"], row["end"]))
    if not notes:
        return ()
    first_q = min(time_map.q96(row["start"]) for row in notes)
    pitched = [row for row in notes if not row["drum"]]
    pitch_anchor = pitched[0]["pitch"] if pitched else 0
    normalized = []
    for row in notes:
        start = time_map.q96(row["start"]) - first_q
        end = time_map.q96(row["end"]) - first_q
        pitch = row["pitch"] if row["drum"] else row["pitch"] - pitch_anchor
        normalized.append((start, max(0, end - start), int(row["drum"]), pitch))
    return tuple(sorted(normalized))


def _json_hash(value: Any) -> str:
    payload = json.dumps(value, separators=(",", ":"),
                         sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def normalized_score_sha256(score: dict[str, Any]) -> str:
    return _json_hash(normalized_note_rows(score))


def _shingle_hashes(rows: Sequence[tuple[int, ...]], width: int = 4
                    ) -> set[int]:
    hashes: set[int] = set()
    for index in range(max(0, len(rows) - width + 1)):
        window = rows[index:index + width]
        start = window[0][0]
        pitched_anchor = next((row[3] for row in window if not row[2]), 0)
        relative = tuple(
            (row[0] - start, row[1], row[2],
             row[3] if row[2] else row[3] - pitched_anchor)
            for row in window)
        digest = hashlib.blake2b(
            json.dumps(relative, separators=(",", ":")).encode(),
            digest_size=8, person=b"scorev2").digest()
        hashes.add(int.from_bytes(digest, "big"))
    return hashes


def structural_signature(rows: Sequence[tuple[int, ...]]) -> tuple[int, ...]:
    """Build a one-permutation 64-bucket MinHash-style sketch."""
    buckets: list[int | None] = [None] * _MINHASH_BUCKETS
    for value in _shingle_hashes(rows):
        bucket = value % _MINHASH_BUCKETS
        remainder = value // _MINHASH_BUCKETS
        if buckets[bucket] is None or remainder < buckets[bucket]:
            buckets[bucket] = remainder
    occupied = [index for index, value in enumerate(buckets)
                if value is not None]
    if not occupied:
        return tuple(0 for _ in buckets)
    dense: list[int] = []
    for index, value in enumerate(buckets):
        if value is not None:
            dense.append(value)
            continue
        distance = 1
        while buckets[(index + distance) % _MINHASH_BUCKETS] is None:
            distance += 1
        donor = buckets[(index + distance) % _MINHASH_BUCKETS]
        payload = f"{index}:{distance}:{donor}".encode()
        dense.append(int.from_bytes(hashlib.blake2b(
            payload, digest_size=8, person=b"densify").digest(), "big"))
    return tuple(dense)


def score_fingerprints(score: dict[str, Any]) -> dict[str, Any]:
    rows = normalized_note_rows(score)
    duration = max((row[0] + row[1] for row in rows), default=0)
    return {
        "schema": FINGERPRINT_SCHEMA,
        "sourceSha256": score["source"]["sha256"],
        "canonicalScoreSha256": score["canonicalScoreSha256"],
        "normalizedScoreSha256": _json_hash(rows),
        "structuralSignature": list(structural_signature(rows)),
        "noteCount": len(rows),
        "duration96": duration,
    }


class _DisjointSet:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, first: int, second: int) -> None:
        left, right = self.find(first), self.find(second)
        if left != right:
            self.parent[max(left, right)] = min(left, right)


def _union_exact(values: Sequence[str], groups: _DisjointSet) -> None:
    first_by_value: dict[str, int] = {}
    for index, value in enumerate(values):
        if value in first_by_value:
            groups.union(index, first_by_value[value])
        else:
            first_by_value[value] = index


def _signature_agreement(first: Sequence[int], second: Sequence[int]) -> float:
    return sum(left == right for left, right in zip(first, second)) / len(first)


def _ratio(first: int, second: int) -> float:
    high = max(first, second)
    return min(first, second) / high if high else 1.0


def build_family_assignments(records: Sequence[dict[str, Any]]) -> dict[str, str]:
    """Return record-id -> family-id after conservative near-match unioning.

    Each record must have a unique string ``id`` and either a ``score`` or a
    precomputed ``fingerprints`` object from :func:`score_fingerprints`.
    """
    ids = [record["id"] for record in records]
    if len(set(ids)) != len(ids):
        raise ValueError("record ids must be unique")
    fingerprints = [record.get("fingerprints")
                    or score_fingerprints(record["score"])
                    for record in records]
    groups = _DisjointSet(len(records))
    for field in ("sourceSha256", "canonicalScoreSha256",
                  "normalizedScoreSha256"):
        _union_exact([row[field] for row in fingerprints], groups)

    bands: dict[tuple[int, tuple[int, ...]], list[int]] = \
        collections.defaultdict(list)
    for index, fingerprint in enumerate(fingerprints):
        if fingerprint["noteCount"] < _MIN_NEAR_NOTES:
            continue
        signature = fingerprint["structuralSignature"]
        candidates: set[int] = set()
        for band in range(8):
            key = (band, tuple(signature[band * 8:(band + 1) * 8]))
            candidates.update(bands[key][-256:])
        for other in candidates:
            prior = fingerprints[other]
            if (_ratio(fingerprint["noteCount"], prior["noteCount"])
                    < _MIN_SIZE_RATIO
                    or _ratio(fingerprint["duration96"], prior["duration96"])
                    < _MIN_SIZE_RATIO):
                continue
            if _signature_agreement(signature, prior["structuralSignature"]) \
                    >= _MIN_SIGNATURE_AGREEMENT:
                groups.union(index, other)
        for band in range(8):
            key = (band, tuple(signature[band * 8:(band + 1) * 8]))
            bands[key].append(index)

    members: dict[int, list[str]] = collections.defaultdict(list)
    for index, record_id in enumerate(ids):
        members[groups.find(index)].append(record_id)
    family_id: dict[int, str] = {}
    for root, family_members in members.items():
        family_id[root] = hashlib.sha256(
            "\n".join(sorted(family_members)).encode()).hexdigest()
    return {record_id: family_id[groups.find(index)]
            for index, record_id in enumerate(ids)}


def split_for_family(family_id: str, seed: int = 20260814) -> str:
    bucket = int.from_bytes(hashlib.sha256(
        f"{seed}:{family_id}".encode()).digest()[:8], "big") % 10_000
    for split, upper in SPLIT_RATIOS:
        if bucket < upper:
            return split
    raise AssertionError("split ratios do not cover all buckets")


def assign_family_splits(assignments: dict[str, str], seed: int = 20260814
                         ) -> dict[str, str]:
    split_by_family = {
        family: split_for_family(family, seed)
        for family in set(assignments.values())
    }
    return {record_id: split_by_family[family]
            for record_id, family in assignments.items()}


def split_leaks(assignments: dict[str, str], splits: dict[str, str]
                ) -> dict[str, list[str]]:
    by_family: dict[str, set[str]] = collections.defaultdict(set)
    for record_id, family in assignments.items():
        by_family[family].add(splits[record_id])
    return {family: sorted(values) for family, values in by_family.items()
            if len(values) > 1}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scores", type=Path,
                        help="directory containing *.score.json[.gz]")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split-seed", type=int, default=20260814)
    args = parser.parse_args()
    paths = sorted(list(args.scores.rglob("*.score.json"))
                   + list(args.scores.rglob("*.score.json.gz")))
    records = [{"id": str(path.relative_to(args.scores)),
                "score": read_score(path)} for path in paths]
    assignments = build_family_assignments(records)
    splits = assign_family_splits(assignments, args.split_seed)
    rows = [{"id": record["id"], "family": assignments[record["id"]],
             "split": splits[record["id"]],
             "fingerprints": score_fingerprints(record["score"])}
            for record in records]
    result = {
        "schema": "chiptunes-score-v2-family-audit-v1",
        "files": len(rows),
        "families": len(set(assignments.values())),
        "splitSeed": args.split_seed,
        "splitFiles": dict(sorted(collections.Counter(
            row["split"] for row in rows).items())),
        "crossSplitFamilies": split_leaks(assignments, splits),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items()
                      if key != "rows"}, sort_keys=True))


if __name__ == "__main__":
    main()
