from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


TIMING_MARGIN = 0.025


def _read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def _write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _close_memmap(array) -> None:
    memory_map = getattr(array, "_mmap", None)
    if memory_map is not None:
        memory_map.close()


def _quality(hypothesis: dict) -> float:
    evidence = hypothesis["evidence"]
    return (
        0.42 * float(evidence["tempo"])
        + 0.24 * float(evidence["grid"])
        + 0.19 * float(evidence["metrical"])
        + 0.15 * float(evidence["loop"])
    )


def timing_passes_without_margin(hypothesis: dict) -> bool:
    evidence = hypothesis["evidence"]
    loop_error = hypothesis.get("loopPhaseErrorFineSteps")
    return bool(
        _quality(hypothesis) >= 0.34
        and float(evidence["grid"]) >= 0.20
        and float(evidence["metrical"]) >= 0.15
        and (loop_error is None or float(loop_error) <= 2.0)
    )


def _projection_equivalent(
    events: np.ndarray,
    left: int,
    right: int,
) -> bool:
    return bool(
        np.array_equal(
            events[f"h{left}FineGrid"],
            events[f"h{right}FineGrid"],
        )
        and np.array_equal(
            events[f"h{left}CoarseGrid"],
            events[f"h{right}CoarseGrid"],
        )
        and np.array_equal(
            events[f"h{left}ResidualSamples"],
            events[f"h{right}ResidualSamples"],
        )
    )


def audit_timing_projection_consensus(
    timing: Path,
    hygiene: Path,
    output: Path,
) -> dict:
    """Find untouched tracks whose only ambiguity is label-equivalent."""

    timing = timing.resolve()
    hygiene = hygiene.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(
            f"refusing to reuse immutable timing consensus audit {output}"
        )
    timing_manifest = json.loads(
        (timing / "manifest.json").read_text(encoding="utf-8")
    )
    hygiene_manifest = json.loads(
        (hygiene / "manifest.json").read_text(encoding="utf-8")
    )
    if (
        timing_manifest.get("schema")
        != "chiptunes-gameboy-dual-clock-dataset-v1"
        or not timing_manifest.get("auditPassed")
        or hygiene_manifest.get("schema")
        != "chiptunes-gameboy-corpus-hygiene-v1"
        or not hygiene_manifest.get("auditPassed")
    ):
        raise RuntimeError(
            "timing consensus requires accepted timing and hygiene"
        )
    hypotheses = _read_jsonl(
        timing / "timing-hypotheses.jsonl"
    )
    hygiene_tracks = _read_jsonl(hygiene / "tracks.jsonl")
    if len(hypotheses) != len(hygiene_tracks):
        raise RuntimeError("timing and hygiene tracks do not align")
    events = np.load(
        timing / "timing-events.npy",
        mmap_mode="r",
    )
    offsets_map = np.load(
        timing / "timing-offsets.npy",
        mmap_mode="r",
    )
    offsets = np.asarray(offsets_map, dtype=np.int64).copy()
    _close_memmap(offsets_map)
    del offsets_map
    if len(offsets) != len(hypotheses) + 1:
        raise RuntimeError("timing consensus offsets do not align")

    qualified_soundtracks = {
        row["soundtrack"] for row in hypotheses if row["qualifiedTop"]
    }
    qualified_components = {
        hygiene_tracks[int(row["trackIndex"])]["componentId"]
        for row in hypotheses
        if row["qualifiedTop"]
    }
    candidates = []
    rejection = Counter()
    by_soundtrack = defaultdict(list)
    for row in hypotheses:
        track_index = int(row["trackIndex"])
        if row["qualifiedTop"]:
            rejection["alreadyQualified"] += 1
            continue
        component = hygiene_tracks[track_index]["componentId"]
        if row["soundtrack"] in qualified_soundtracks:
            rejection["representedSoundtrack"] += 1
            continue
        if component in qualified_components:
            rejection["representedComponent"] += 1
            continue
        top = row["hypotheses"][0]
        if not timing_passes_without_margin(top):
            rejection["topEvidence"] += 1
            continue
        plausible = [
            hypothesis
            for hypothesis in row["hypotheses"]
            if float(top["score"]) - float(hypothesis["score"])
            < TIMING_MARGIN
        ]
        if len(plausible) < 2:
            rejection["notMarginOnly"] += 1
            continue
        start = int(offsets[track_index])
        end = int(offsets[track_index + 1])
        track_events = events[start:end]
        if not all(
            _projection_equivalent(
                track_events,
                int(top["rank"]),
                int(hypothesis["rank"]),
            )
            for hypothesis in plausible[1:]
        ):
            rejection["projectionDisagreement"] += 1
            continue
        candidate = {
            "trackIndex": track_index,
            "source": row["source"],
            "soundtrack": row["soundtrack"],
            "componentId": component,
            "originalSplit": row["split"],
            "events": end - start,
            "plausibleHypotheses": len(plausible),
            "plausibleProbability": round(
                sum(
                    float(hypothesis["confidence"])
                    for hypothesis in plausible
                ),
                9,
            ),
            "topHypothesis": top,
        }
        candidates.append(candidate)
        by_soundtrack[row["soundtrack"]].append(candidate)
    _close_memmap(events)
    del events

    soundtrack_rows = []
    for soundtrack, rows in by_soundtrack.items():
        soundtrack_rows.append(
            {
                "soundtrack": soundtrack,
                "tracks": len(rows),
                "events": sum(row["events"] for row in rows),
                "components": len(
                    {row["componentId"] for row in rows}
                ),
                "originalSplits": dict(
                    sorted(
                        Counter(
                            row["originalSplit"] for row in rows
                        ).items()
                    )
                ),
                "stableOrder": hashlib.sha256(
                    soundtrack.encode("utf-8")
                ).hexdigest(),
            }
        )
    soundtrack_rows.sort(
        key=lambda row: (-row["tracks"], row["stableOrder"])
    )
    audit = {
        "schema": "chiptunes-timing-projection-consensus-audit-v1",
        "timingFingerprint": timing_manifest["contentFingerprint"],
        "hygieneFingerprint": hygiene_manifest["contentFingerprint"],
        "margin": TIMING_MARGIN,
        "tracks": len(hypotheses),
        "candidateTracks": len(candidates),
        "candidateSoundtracks": len(soundtrack_rows),
        "candidateEvents": sum(row["events"] for row in candidates),
        "rejection": dict(sorted(rejection.items())),
        "soundtracks": soundtrack_rows,
        "candidates": sorted(
            candidates,
            key=lambda row: int(row["trackIndex"]),
        ),
    }
    audit["passed"] = (
        audit["candidateTracks"] > 0
        and audit["candidateSoundtracks"] > 0
        and not (
            qualified_soundtracks
            & {row["soundtrack"] for row in candidates}
        )
        and not (
            qualified_components
            & {row["componentId"] for row in candidates}
        )
    )
    output.mkdir(parents=True)
    audit_path = output / "audit.json"
    _write_json(audit_path, audit)
    manifest = {
        "schema": (
            "chiptunes-timing-projection-consensus-artifact-v1"
        ),
        "timingFingerprint": audit["timingFingerprint"],
        "hygieneFingerprint": audit["hygieneFingerprint"],
        "candidateTracks": audit["candidateTracks"],
        "candidateSoundtracks": audit["candidateSoundtracks"],
        "auditSha256": hashlib.sha256(
            audit_path.read_bytes()
        ).hexdigest(),
        "passed": audit["passed"],
    }
    manifest["contentFingerprint"] = hashlib.sha256(
        json.dumps(
            manifest,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    _write_json(output / "manifest.json", manifest)
    return {"manifest": manifest, "audit": audit}
