"""Exact, resumable corpus-wide timing audit for an existing score-v2 build.

The original builder retained per-file medians and p99 values.  Those are
useful diagnostics but cannot prove corpus-wide quantiles.  This auditor reads
every kept canonical score, counts every note against the preregistered
5/20-ms onset and 10/40-ms duration limits, and writes a receipt bound to the
source manifest hash.  It never approximates a quantile or infers progress
from process presence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable

from audit_score_v2 import ScoreTimeMap
from midi_score_v2 import read_score


SCHEMA = "chiptunes-midi-score-v2-timing-audit-v1"
COUNT_KEYS = (
    "notes", "onsetAtMost5Ms", "onsetAtMost20Ms",
    "durationAtMost10Ms", "durationAtMost40Ms",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n",
                         encoding="utf-8")
    os.replace(temporary, path)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _timing_row(task: tuple[str, dict[str, Any]]) -> dict[str, Any]:
    build_text, source = task
    build = Path(build_text)
    score = read_score(build / source["scorePath"])
    if score["canonicalScoreSha256"] != source["canonicalScoreSha256"]:
        raise ValueError(f"score hash mismatch for {source['relativePath']}")
    time_map = ScoreTimeMap(score)
    counts = {key: 0 for key in COUNT_KEYS}
    maxima = {"onsetMs": Fraction(0), "durationMs": Fraction(0)}
    for note in score["notes"]:
        start_q = time_map.q96(note["start"])
        end_q = time_map.q96(note["end"])
        duration_q = max(0, end_q - start_q)
        original_start = time_map.microseconds(note["start"])
        original_end = time_map.microseconds(note["end"])
        decoded_start = time_map.microseconds_at_q96(start_q)
        decoded_end = time_map.microseconds_at_q96(start_q + duration_q)
        onset_us = abs(decoded_start - original_start)
        duration_us = abs(
            (decoded_end - decoded_start) - (original_end - original_start))
        counts["notes"] += 1
        counts["onsetAtMost5Ms"] += onset_us <= 5_000
        counts["onsetAtMost20Ms"] += onset_us <= 20_000
        counts["durationAtMost10Ms"] += duration_us <= 10_000
        counts["durationAtMost40Ms"] += duration_us <= 40_000
        maxima["onsetMs"] = max(maxima["onsetMs"], onset_us / 1_000)
        maxima["durationMs"] = max(maxima["durationMs"], duration_us / 1_000)
    if counts["notes"] != source["scoreStatistics"]["notes"]:
        raise ValueError(f"note count mismatch for {source['relativePath']}")
    return {
        "relativePath": source["relativePath"],
        "scorePath": source["scorePath"],
        "canonicalScoreSha256": source["canonicalScoreSha256"],
        "counts": counts,
        "maximumErrorMs": {key: round(float(value), 6)
                           for key, value in maxima.items()},
    }


def _tasks(build: Path, rows: Iterable[dict[str, Any]]) \
        -> Iterable[tuple[str, dict[str, Any]]]:
    for row in rows:
        yield str(build), row


def _progress(output: Path, total: int, rows: list[dict[str, Any]],
              started: float, session_start_count: int, state: str,
              error: str | None = None) -> None:
    elapsed = max(time.monotonic() - started, 1e-9)
    rate = max(0, len(rows) - session_start_count) / elapsed
    _atomic_json(output / "progress.json", {
        "schema": SCHEMA,
        "state": state,
        "filesConsidered": len(rows),
        "filesTotal": total,
        "fraction": len(rows) / total if total else 1.0,
        "filesPerSecond": rate,
        "etaSeconds": (total - len(rows)) / rate if rate else None,
        "notesConsidered": sum(row["counts"]["notes"] for row in rows),
        "error": error,
    })


def run(build: Path, output: Path, workers: int = 0,
        progress_every: int = 100, limit: int | None = None) -> dict[str, Any]:
    manifest_path = build / "manifest.jsonl"
    source_rows = [row for row in _read_jsonl(manifest_path)
                   if row.get("status") == "kept"]
    if limit is not None:
        source_rows = source_rows[:limit]
    output.mkdir(parents=True, exist_ok=True)
    config = {
        "schema": SCHEMA,
        "build": str(build),
        "corpusManifestSha256": _sha256(manifest_path),
        "keptFiles": len(source_rows),
        "limit": limit,
        "thresholdsMs": {"onsetMedian": 5, "onsetP99": 20,
                         "durationMedian": 10, "durationP99": 40},
    }
    config_path = output / "config.json"
    if config_path.is_file():
        if json.loads(config_path.read_text(encoding="utf-8")) != config:
            raise ValueError("existing timing audit configuration differs")
    else:
        _atomic_json(config_path, config)
    audit_manifest = output / "manifest.jsonl"
    rows = _read_jsonl(audit_manifest)
    completed = {row["relativePath"] for row in rows}
    if len(completed) != len(rows):
        raise ValueError("timing audit manifest contains duplicate files")
    pending = [row for row in source_rows if row["relativePath"] not in completed]
    started = time.monotonic()
    session_start_count = len(rows)
    _progress(output, len(source_rows), rows, started, session_start_count,
              "running")
    try:
        with audit_manifest.open("a", encoding="utf-8", newline="\n",
                                 buffering=1) as handle:
            executor = ProcessPoolExecutor(max_workers=workers or None)
            try:
                for result in executor.map(
                        _timing_row, _tasks(build, pending), chunksize=4):
                    handle.write(json.dumps(
                        result, separators=(",", ":"), sort_keys=True) + "\n")
                    rows.append(result)
                    if len(rows) % progress_every == 0:
                        handle.flush()
                        os.fsync(handle.fileno())
                        _progress(output, len(source_rows), rows, started,
                                  session_start_count, "running")
            finally:
                executor.shutdown(wait=True, cancel_futures=True)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception as error:
        _progress(output, len(source_rows), rows, started,
                  session_start_count, "failed",
                  f"{type(error).__name__}: {error}")
        raise
    counts = {key: sum(row["counts"][key] for row in rows)
              for key in COUNT_KEYS}
    notes = counts["notes"]
    conditions = {
        "onsetMedianTimingPassed":
            counts["onsetAtMost5Ms"] >= math.ceil(0.50 * notes),
        "onsetTimingPassed":
            counts["onsetAtMost20Ms"] >= math.ceil(0.99 * notes),
        "durationMedianTimingPassed":
            counts["durationAtMost10Ms"] >= math.ceil(0.50 * notes),
        "durationTimingPassed":
            counts["durationAtMost40Ms"] >= math.ceil(0.99 * notes),
    }
    receipt = {
        **config,
        "status": "complete",
        "filesAudited": len(rows),
        "counts": counts,
        "shares": {key: round(counts[key] / notes, 9) if notes else None
                   for key in COUNT_KEYS if key != "notes"},
        "maximumErrorMs": {
            key: max((row["maximumErrorMs"][key] for row in rows), default=0)
            for key in ("onsetMs", "durationMs")
        },
        "conditions": conditions,
        "passed": bool(notes) and all(conditions.values()),
        "auditManifestSha256": _sha256(audit_manifest),
    }
    _atomic_json(output / "receipt.json", receipt)
    _progress(output, len(source_rows), rows, started, session_start_count,
              "complete")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("build", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--progress-every", type=int, default=100)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    result = run(args.build, args.output, args.workers,
                 args.progress_every, args.limit)
    print(json.dumps({key: value for key, value in result.items()
                      if key not in {"maximumErrorMs"}}, sort_keys=True))


if __name__ == "__main__":
    main()
