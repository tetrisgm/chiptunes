"""Resumable, instrumented score-v2 corpus builder.

The builder is intentionally single-process and bounded to one source root. It
durably appends one manifest row per input, atomically updates progress, and
can resume after interruption without inferring progress from process state.
Every kept score passes canonical MIDI reconstruction, compound represented-
field decode, and fingerprinting before its manifest row is committed.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from audit_score_v2 import (
    ScoreTimeMap,
    assign_family_splits,
    build_family_assignments,
    score_fingerprints,
    split_leaks,
)
from midi_score_v2 import MidiParseError, parse_smf, score_bytes
from render_score_v2 import verified_score_to_smf
from tokenize_score_v2 import encode_score


BUILD_SCHEMA = "chiptunes-midi-score-v2-build-v1"
PROGRESS_SCHEMA = "chiptunes-midi-score-v2-progress-v1"
MIDI_EXTENSIONS = {".mid", ".midi", ".kar"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True)
class BuildConfig:
    source_root: Path
    output: Path
    source_label: str
    authority_note: str
    minimum_notes: int = 16
    minimum_duration96: int = 384
    progress_every: int = 100
    limit: int | None = None

    def persisted(self) -> dict[str, Any]:
        return {
            "schema": BUILD_SCHEMA,
            "sourceRoot": str(self.source_root.resolve()),
            "sourceLabel": self.source_label,
            "authorityNote": self.authority_note,
            "extensions": sorted(MIDI_EXTENSIONS),
            "minimumNotes": self.minimum_notes,
            "minimumDuration96": self.minimum_duration96,
            "limit": self.limit,
        }


def _inventory(config: BuildConfig) -> list[Path]:
    paths = sorted(path for path in config.source_root.rglob("*")
                   if path.is_file() and path.suffix.lower() in MIDI_EXTENSIONS)
    return paths[:config.limit] if config.limit is not None else paths


def _read_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"invalid manifest JSON at line {line_number}: {error}") from error
    return rows


def _reason_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    return dict(sorted(collections.Counter(
        row["reason"] for row in rows if row["status"] != "kept").items()))


def _progress(config: BuildConfig, total: int, rows: list[dict[str, Any]],
              state: str, started: float, session_start_count: int,
              current: str | None = None, error: str | None = None
              ) -> dict[str, Any]:
    elapsed = max(time.monotonic() - started, 1e-9)
    session_done = len(rows) - session_start_count
    rate = session_done / elapsed
    remaining = max(0, total - len(rows))
    status_counts = collections.Counter(row["status"] for row in rows)
    value = {
        "schema": PROGRESS_SCHEMA,
        "status": state,
        "sourceLabel": config.source_label,
        "updatedUtc": _utc_now(),
        "considered": len(rows),
        "total": total,
        "fraction": round(len(rows) / total, 8) if total else 1.0,
        "statusCounts": dict(sorted(status_counts.items())),
        "reasonCounts": _reason_counts(rows),
        "sessionFilesPerSecond": round(rate, 6) if session_done else None,
        "etaSeconds": round(remaining / rate, 3) if rate > 0 else None,
        "current": current,
        "error": error,
        "manifest": str(config.output / "manifest.jsonl"),
    }
    _atomic_json(config.output / "progress.json", value)
    return value


def _duration96(score: dict[str, Any]) -> int:
    if not score["notes"]:
        return 0
    time_map = ScoreTimeMap(score)
    start = min(time_map.q96(row["start"]) for row in score["notes"])
    end = max(time_map.q96(row["end"]) for row in score["notes"])
    return max(0, end - start)


def _write_score_atomic(path: Path, score: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("wb") as handle:
        handle.write(score_bytes(score))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _family_outputs(config: BuildConfig, kept: list[dict[str, Any]]) -> dict[str, Any]:
    records = [{"id": row["relativePath"],
                "fingerprints": row["fingerprints"]} for row in kept]
    assignments = build_family_assignments(records)
    splits = assign_family_splits(assignments)
    family_path = config.output / "families.jsonl"
    with family_path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in kept:
            record_id = row["relativePath"]
            handle.write(json.dumps({
                "relativePath": record_id,
                "family": assignments[record_id],
                "split": splits[record_id],
            }, separators=(",", ":"), sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    family_counts = collections.Counter(assignments.values())
    return {
        "families": len(family_counts),
        "duplicateFamilies": sum(value > 1 for value in family_counts.values()),
        "largestFamily": max(family_counts.values(), default=0),
        "splitFiles": dict(sorted(collections.Counter(splits.values()).items())),
        "crossSplitFamilies": split_leaks(assignments, splits),
        "familiesManifestSha256": _sha256(family_path.read_bytes()),
    }


def _summary(config: BuildConfig, inventory: list[Path],
             rows: list[dict[str, Any]]) -> dict[str, Any]:
    kept = [row for row in rows if row["status"] == "kept"]
    family = _family_outputs(config, kept)
    onset_p99 = [row["compound"]["onsetErrorMsP99"] for row in kept
                 if row["compound"]["onsetErrorMsP99"] is not None]
    duration_p99 = [row["compound"]["durationErrorMsP99"] for row in kept
                    if row["compound"]["durationErrorMsP99"] is not None]
    onset_medians = [row["compound"]["onsetErrorMsMedian"] for row in kept
                     if row["compound"]["onsetErrorMsMedian"] is not None]
    duration_medians = [
        row["compound"]["durationErrorMsMedian"] for row in kept
        if row["compound"]["durationErrorMsMedian"] is not None]
    manifest_path = config.output / "manifest.jsonl"
    manifest_sha256 = _sha256(manifest_path.read_bytes())
    timing_counts = [row["compound"].get("timingThresholdCounts")
                     for row in kept]
    timing_distribution: dict[str, Any] | None = None
    timing_source: str | None = None
    if timing_counts and all(value is not None for value in timing_counts):
        timing_distribution = {
            key: sum(value[key] for value in timing_counts)
            for key in ("notes", "onsetAtMost5Ms", "onsetAtMost20Ms",
                        "durationAtMost10Ms", "durationAtMost40Ms")
        }
        timing_source = "manifest-threshold-counts"
    else:
        timing_receipt_path = config.output / "timing-audit" / "receipt.json"
        if timing_receipt_path.is_file():
            timing_receipt = json.loads(
                timing_receipt_path.read_text(encoding="utf-8"))
            if timing_receipt.get("status") != "complete" \
                    or timing_receipt.get("corpusManifestSha256") \
                    != manifest_sha256:
                raise ValueError("timing audit receipt does not match corpus")
            timing_distribution = timing_receipt["counts"]
            timing_source = "timing-audit-receipt"
    if timing_distribution:
        timing_notes = timing_distribution["notes"]
        timing_conditions = {
            "onsetMedianTimingPassed":
                timing_distribution["onsetAtMost5Ms"]
                >= math.ceil(0.50 * timing_notes),
            "onsetTimingPassed":
                timing_distribution["onsetAtMost20Ms"]
                >= math.ceil(0.99 * timing_notes),
            "durationMedianTimingPassed":
                timing_distribution["durationAtMost10Ms"]
                >= math.ceil(0.50 * timing_notes),
            "durationTimingPassed":
                timing_distribution["durationAtMost40Ms"]
                >= math.ceil(0.99 * timing_notes),
        }
        timing_distribution = {
            **timing_distribution,
            "source": timing_source,
            "shares": {
                key: round(timing_distribution[key] / timing_notes, 9)
                if timing_notes else None
                for key in ("onsetAtMost5Ms", "onsetAtMost20Ms",
                            "durationAtMost10Ms", "durationAtMost40Ms")
            },
        }
    else:
        timing_conditions = {
            "onsetMedianTimingPassed": False,
            "onsetTimingPassed": False,
            "durationMedianTimingPassed": False,
            "durationTimingPassed": False,
        }
    representation_roundtrip = sum(
        row["compound"]["representedRoundtrip"] for row in kept)
    result = {
        "schema": "chiptunes-midi-score-v2-build-receipt-v1",
        "recordedUtc": _utc_now(),
        "status": "complete",
        "config": config.persisted(),
        "files": {
            "inventory": len(inventory),
            "considered": len(rows),
            "kept": len(kept),
            "statusCounts": dict(sorted(collections.Counter(
                row["status"] for row in rows).items())),
            "reasonCounts": _reason_counts(rows),
        },
        "music": {
            "notes": sum(row["scoreStatistics"]["notes"] for row in kept),
            "compoundEvents": sum(row["compound"]["events"] for row in kept),
            "representedRoundtrip": representation_roundtrip,
            "canonicalRoundtripPassed": len(kept),
        },
        "timing": {
            "worstFileOnsetMedianMs": max(onset_medians, default=None),
            "worstFileOnsetP99Ms": max(onset_p99, default=None),
            "worstFileDurationMedianMs": max(duration_medians, default=None),
            "worstFileDurationP99Ms": max(duration_p99, default=None),
            "onsetMedianLimitMs": 5,
            "onsetLimitMs": 20,
            "durationMedianLimitMs": 10,
            "durationLimitMs": 40,
            "distribution": timing_distribution,
        },
        "familiesAndSplits": family,
        "manifestSha256": manifest_sha256,
    }
    result["machineGate"] = {
        "nonEmptyCorpus": bool(kept),
        "representedFieldsExact": all(
            row["compound"]["representedRoundtrip"]
            == sum(row["scoreCounts"].values()) for row in kept),
        "canonicalRoundtripExact": True,
        "timingDistributionAvailable": timing_distribution is not None,
        **timing_conditions,
        "crossSplitLeakagePassed": not family["crossSplitFamilies"],
    }
    result["machineGate"]["passed"] = all(result["machineGate"].values())
    _atomic_json(config.output / "receipt.json", result)
    return result


def run_build(config: BuildConfig) -> dict[str, Any]:
    if config.minimum_notes < 1 or config.minimum_duration96 < 1 \
            or config.progress_every < 1:
        raise ValueError("build thresholds and progress interval must be positive")
    config.output.mkdir(parents=True, exist_ok=True)
    config_path = config.output / "config.json"
    persisted = config.persisted()
    if config_path.exists():
        existing = json.loads(config_path.read_text(encoding="utf-8"))
        if existing != persisted:
            raise ValueError("existing output configuration does not match request")
    else:
        _atomic_json(config_path, persisted)

    inventory = _inventory(config)
    manifest_path = config.output / "manifest.jsonl"
    rows = _read_manifest(manifest_path)
    processed = {row["relativePath"] for row in rows}
    if len(processed) != len(rows):
        raise ValueError("manifest contains duplicate relative paths")
    inventory_ids = {str(path.relative_to(config.source_root)).replace("\\", "/")
                     for path in inventory}
    if not processed <= inventory_ids:
        raise ValueError("manifest contains files outside current inventory")
    seen_source: dict[str, str] = {}
    for row in rows:
        if row.get("sourceSha256"):
            seen_source.setdefault(row["sourceSha256"], row["relativePath"])
    seen_canonical = {
        row["canonicalScoreSha256"]: row["relativePath"] for row in rows
        if row["status"] == "kept"}
    started = time.monotonic()
    session_start_count = len(rows)
    _progress(config, len(inventory), rows, "running", started,
              session_start_count)

    with manifest_path.open("a", encoding="utf-8", newline="\n",
                            buffering=1) as manifest:
        for path in inventory:
            relative = str(path.relative_to(config.source_root)).replace("\\", "/")
            if relative in processed:
                continue
            source_sha: str | None = None
            try:
                payload = path.read_bytes()
                source_sha = _sha256(payload)
                base = {
                    "relativePath": relative,
                    "sourceLabel": config.source_label,
                    "bytes": len(payload),
                    "sourceSha256": source_sha,
                }
                if source_sha in seen_source:
                    row = {**base, "status": "dropped", "reason": "byte-duplicate",
                           "duplicateOf": seen_source[source_sha]}
                else:
                    score = parse_smf(payload, relative)
                    canonical = score["canonicalScoreSha256"]
                    base["canonicalScoreSha256"] = canonical
                    if score["issues"]:
                        row = {**base, "status": "rejected",
                               "reason": "score-issues", "issues": score["issues"]}
                    elif score["statistics"]["notes"] < config.minimum_notes:
                        row = {**base, "status": "rejected",
                               "reason": "trivially-short-notes",
                               "notes": score["statistics"]["notes"]}
                    else:
                        duration96 = _duration96(score)
                        if duration96 < config.minimum_duration96:
                            row = {**base, "status": "rejected",
                                   "reason": "trivially-short-duration",
                                   "duration96": duration96}
                        elif canonical in seen_canonical:
                            row = {**base, "status": "dropped",
                                   "reason": "canonical-duplicate",
                                   "duplicateOf": seen_canonical[canonical]}
                        else:
                            verified_score_to_smf(score)
                            compound = encode_score(score)
                            counts = {
                                key: len(score[key]) for key in (
                                    "notes", "tempos", "timeSignatures",
                                    "keySignatures", "controls", "pitchBends",
                                    "polyPressure", "channelPressure")
                            }
                            fingerprint = score_fingerprints(score)
                            score_relative = (Path("scores") / canonical[:2]
                                              / f"{canonical}.score.json.gz")
                            _write_score_atomic(
                                config.output / score_relative, score)
                            row = {
                                **base, "status": "kept", "reason": "kept",
                                "scorePath": str(score_relative).replace(
                                    "\\", "/"),
                                "scoreStatistics": score["statistics"],
                                "scoreCounts": counts,
                                "compound": compound["statistics"],
                                "unrepresentedStreams":
                                    compound["unrepresentedStreams"],
                                "fingerprints": fingerprint,
                            }
                            seen_canonical[canonical] = relative
                    seen_source[source_sha] = relative
            except MidiParseError as error:
                row = {
                    "relativePath": relative, "sourceLabel": config.source_label,
                    "bytes": path.stat().st_size,
                    "sourceSha256": source_sha,
                    "status": "rejected",
                    "reason": "parse-error", "error": str(error),
                }
                if row["sourceSha256"]:
                    seen_source.setdefault(row["sourceSha256"], relative)
            except Exception as error:
                _progress(config, len(inventory), rows, "failed", started,
                          session_start_count, relative,
                          f"{type(error).__name__}: {error}")
                raise

            manifest.write(json.dumps(
                row, separators=(",", ":"), sort_keys=True) + "\n")
            rows.append(row)
            processed.add(relative)
            if len(rows) % config.progress_every == 0:
                manifest.flush()
                os.fsync(manifest.fileno())
                _progress(config, len(inventory), rows, "running", started,
                          session_start_count, relative)
        manifest.flush()
        os.fsync(manifest.fileno())

    result = _summary(config, inventory, rows)
    _progress(config, len(inventory), rows, "complete", started,
              session_start_count)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-label", required=True)
    parser.add_argument("--authority-note", required=True)
    parser.add_argument("--minimum-notes", type=int, default=16)
    parser.add_argument("--minimum-duration96", type=int, default=384)
    parser.add_argument("--progress-every", type=int, default=100)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    result = run_build(BuildConfig(
        source_root=args.source_root, output=args.output,
        source_label=args.source_label, authority_note=args.authority_note,
        minimum_notes=args.minimum_notes,
        minimum_duration96=args.minimum_duration96,
        progress_every=args.progress_every, limit=args.limit))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
