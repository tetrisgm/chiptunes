from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from .factorization import (
    CHANNEL_NAMES,
    COARSE_STEPS_PER_BAR,
    FINE_STEPS_PER_BAR,
)


FINE_EVENT_DTYPE = np.dtype(
    [
        ("barIndex", "<i4"),
        ("trackIndex", "<i4"),
        ("sourceEventIndex", "<i8"),
        ("channel", "u1"),
        ("coarseSlot", "u1"),
        ("fineSlot", "u1"),
        ("fineOffset", "i1"),
        ("anchorOccurrence", "<u2"),
        ("residualSamples", "<i4"),
    ]
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def _close_memmap(array) -> None:
    memory_map = getattr(array, "_mmap", None)
    if memory_map is not None:
        memory_map.close()


def _round_divide(values, denominator: int):
    values = np.asarray(values, dtype=np.int64)
    absolute = np.abs(values)
    rounded = (2 * absolute + denominator) // (2 * denominator)
    return np.where(values < 0, -rounded, rounded)


def _quantiles(values) -> dict:
    rows = np.asarray(list(values), dtype=np.float64)
    if not len(rows):
        return {}
    return {
        str(percentile): round(float(np.percentile(rows, percentile)), 6)
        for percentile in (0, 1, 5, 25, 50, 75, 95, 99, 100)
    }


def cyclic_fine_offset(
    fine_slots: np.ndarray,
    coarse_slots: np.ndarray,
) -> np.ndarray:
    """Return the nearest signed 128-step offset from a coarse anchor."""

    difference = (
        np.asarray(fine_slots, dtype=np.int64)
        - np.asarray(coarse_slots, dtype=np.int64) * 4
    )
    return ((difference + 64) % FINE_STEPS_PER_BAR - 64).astype(
        np.int8
    )


def factor_track_fine_timing(
    track_index: int,
    bar_start: int,
    plans: np.ndarray,
    source_event_start: int,
    events: np.ndarray,
    timing_hypothesis: dict,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """Associate every exact event with its coarse anchor and fine offset."""

    fine_counts = np.zeros(
        (len(plans), 4, FINE_STEPS_PER_BAR),
        dtype=np.uint16,
    )
    anchor_counts = np.zeros(
        (len(plans), 4, COARSE_STEPS_PER_BAR),
        dtype=np.uint16,
    )
    output = np.zeros(len(events), dtype=FINE_EVENT_DTYPE)
    if not len(events):
        return (
            output,
            fine_counts,
            anchor_counts,
            {
                "events": 0,
                "mappedEvents": 0,
                "unmappedEvents": 0,
                "fineGridRoundtripErrors": 0,
                "sampleRoundtripErrors": 0,
                "eventBarOrderErrors": 0,
            },
        )
    if not len(plans):
        raise ValueError("fine timing events require hierarchy bars")

    source_bars = np.floor_divide(
        events["fineGrid"].astype(np.int64),
        FINE_STEPS_PER_BAR,
    )
    first_source_bar = int(plans[0]["sourceBar"])
    relative_bars = source_bars - first_source_bar
    valid = (relative_bars >= 0) & (relative_bars < len(plans))
    mapped = np.zeros(len(events), dtype=bool)
    mapped[valid] = (
        plans["sourceBar"][relative_bars[valid]].astype(np.int64)
        == source_bars[valid]
    )
    if not np.all(mapped):
        raise ValueError(
            f"track {track_index} has events outside hierarchy bars"
        )

    fine_slots = np.mod(
        events["fineGrid"].astype(np.int64),
        FINE_STEPS_PER_BAR,
    )
    coarse_slots = np.mod(
        events["coarseGrid"].astype(np.int64),
        COARSE_STEPS_PER_BAR,
    )
    channels = events["channel"].astype(np.int64)
    offsets = cyclic_fine_offset(fine_slots, coarse_slots)
    global_bars = bar_start + relative_bars
    np.add.at(
        fine_counts,
        (relative_bars, channels, fine_slots),
        1,
    )
    np.add.at(
        anchor_counts,
        (relative_bars, channels, coarse_slots),
        1,
    )

    output["barIndex"] = global_bars
    output["trackIndex"] = track_index
    output["sourceEventIndex"] = (
        source_event_start + np.arange(len(events), dtype=np.int64)
    )
    output["channel"] = channels
    output["coarseSlot"] = coarse_slots
    output["fineSlot"] = fine_slots
    output["fineOffset"] = offsets
    output["residualSamples"] = events["residualSamples"]
    occurrences: dict[tuple[int, int, int], int] = {}
    previous_offsets: dict[tuple[int, int, int], int] = {}
    offset_regressions = 0
    for index, key in enumerate(
        zip(
            relative_bars.tolist(),
            channels.tolist(),
            coarse_slots.tolist(),
        )
    ):
        occurrence = occurrences.get(key, 0)
        output[index]["anchorOccurrence"] = occurrence
        occurrences[key] = occurrence + 1
        offset = int(offsets[index])
        if key in previous_offsets and offset < previous_offsets[key]:
            offset_regressions += 1
        previous_offsets[key] = offset

    reconstructed_slots = np.mod(
        coarse_slots * 4 + offsets.astype(np.int64),
        FINE_STEPS_PER_BAR,
    )
    reconstructed_grid = (
        source_bars * FINE_STEPS_PER_BAR + reconstructed_slots
    )
    fine_grid_errors = int(
        np.count_nonzero(
            reconstructed_grid != events["fineGrid"].astype(np.int64)
        )
    )
    bar_numerator = int(timing_hypothesis["barSamplesNumerator"])
    bpm_milli = int(timing_hypothesis["bpmMilli"])
    snapped = _round_divide(
        events["fineGrid"].astype(np.int64) * bar_numerator,
        bpm_milli * FINE_STEPS_PER_BAR,
    )
    restored_samples = (
        int(timing_hypothesis["phaseSample"])
        + snapped
        + events["residualSamples"].astype(np.int64)
    )
    sample_errors = int(
        np.count_nonzero(
            restored_samples != events["sample"].astype(np.int64)
        )
    )
    return (
        output,
        fine_counts,
        anchor_counts,
        {
            "events": len(events),
            "mappedEvents": int(np.count_nonzero(mapped)),
            "unmappedEvents": int(np.count_nonzero(~mapped)),
            "fineGridRoundtripErrors": fine_grid_errors,
            "sampleRoundtripErrors": sample_errors,
            "eventBarOrderErrors": int(
                np.count_nonzero(np.diff(global_bars) < 0)
            ),
            "anchorOffsetRegressions": offset_regressions,
        },
    )


def _same_slot_co_onsets(fine_counts: np.ndarray) -> np.ndarray:
    present = fine_counts > 0
    output = np.zeros((4, 4), dtype=np.int64)
    for left in range(4):
        for right in range(4):
            output[left, right] = np.count_nonzero(
                present[:, left] & present[:, right]
            )
    return output


def build_fine_timing_dataset(
    factorization: Path,
    hierarchy: Path,
    output: Path,
) -> dict:
    factorization = factorization.resolve()
    hierarchy = hierarchy.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(
            f"refusing to reuse immutable fine timing output {output}"
        )
    output.mkdir(parents=True)
    factor_manifest = json.loads(
        (factorization / "manifest.json").read_text(encoding="utf-8")
    )
    hierarchy_manifest = json.loads(
        (hierarchy / "manifest.json").read_text(encoding="utf-8")
    )
    hierarchy_audit = json.loads(
        (hierarchy / "audit.json").read_text(encoding="utf-8")
    )
    if (
        factor_manifest["schema"]
        != "chiptunes-gameboy-factorized-dataset-v3"
        or not factor_manifest["auditPassed"]
        or hierarchy_manifest["schema"]
        != "chiptunes-gameboy-hierarchy-dataset-v2"
        or not hierarchy_manifest["auditPassed"]
        or hierarchy_manifest["factorizationFingerprint"]
        != factor_manifest["contentFingerprint"]
    ):
        raise RuntimeError(
            "fine timing requires aligned accepted factorization and hierarchy"
        )

    factor_tracks = _read_jsonl(factorization / "tracks.jsonl")
    hierarchy_tracks = _read_jsonl(hierarchy / "tracks.jsonl")
    hierarchy_track_by_index = {
        int(track["trackIndex"]): track for track in hierarchy_tracks
    }
    composition = np.load(
        factorization / factor_manifest["compositionEventsFile"],
        mmap_mode="r",
    )
    source_offsets_map = np.load(
        factorization / "event-offsets.npy",
        mmap_mode="r",
    )
    source_offsets = np.asarray(
        source_offsets_map,
        dtype=np.int64,
    ).copy()
    _close_memmap(source_offsets_map)
    plans = np.load(
        hierarchy / hierarchy_manifest["barPlansFile"],
        mmap_mode="r",
    )
    coarse_multiplicity = np.load(
        hierarchy / hierarchy_manifest["coarseMultiplicityFile"],
        mmap_mode="r",
    )
    bar_offsets_map = np.load(
        hierarchy / hierarchy_manifest["barOffsetsFile"],
        mmap_mode="r",
    )
    bar_offsets = np.asarray(bar_offsets_map, dtype=np.int64).copy()
    _close_memmap(bar_offsets_map)
    if (
        len(factor_tracks) != factor_manifest["tracks"]
        or len(source_offsets) != len(factor_tracks) + 1
        or len(plans) != hierarchy_manifest["bars"]
        or len(coarse_multiplicity) != len(plans)
        or len(bar_offsets) != len(factor_tracks) + 1
    ):
        raise RuntimeError("fine timing source arrays do not align")

    total_events = int(hierarchy_audit["mappedEvents"])
    fine_partial = output / "fine-multiplicity.partial.npy"
    fine_path = output / "fine-multiplicity.npy"
    events_partial = output / "fine-events.partial.npy"
    events_path = output / "fine-events.npy"
    fine_counts = np.lib.format.open_memmap(
        fine_partial,
        mode="w+",
        dtype=np.uint16,
        shape=(len(plans), 4, FINE_STEPS_PER_BAR),
    )
    fine_events = np.lib.format.open_memmap(
        events_partial,
        mode="w+",
        dtype=FINE_EVENT_DTYPE,
        shape=(total_events,),
    )
    anchor_counts = np.zeros_like(coarse_multiplicity)
    bar_event_counts = np.zeros(len(plans), dtype=np.int64)
    totals = Counter()
    split_events = Counter()
    offset_values = [[] for _ in range(4)]
    residual_values = [[] for _ in range(4)]
    cursor = 0

    for track_index, track in enumerate(factor_tracks):
        source_start = int(source_offsets[track_index])
        source_end = int(source_offsets[track_index + 1])
        bar_start = int(bar_offsets[track_index])
        bar_end = int(bar_offsets[track_index + 1])
        if track["qualifiedTiming"]:
            if track_index not in hierarchy_track_by_index:
                raise RuntimeError(
                    f"qualified track {track_index} missing from hierarchy"
                )
            track_plans = np.asarray(plans[bar_start:bar_end])
            track_events = np.asarray(composition[source_start:source_end])
            (
                factored,
                track_fine_counts,
                track_anchor_counts,
                audit,
            ) = factor_track_fine_timing(
                track_index,
                bar_start,
                track_plans,
                source_start,
                track_events,
                track["timingHypotheses"][0],
            )
            end = cursor + len(factored)
            if end > total_events:
                raise RuntimeError("fine timing event allocation overflow")
            fine_events[cursor:end] = factored
            fine_counts[bar_start:bar_end] = track_fine_counts
            anchor_counts[bar_start:bar_end] = track_anchor_counts
            np.add.at(
                bar_event_counts,
                factored["barIndex"].astype(np.int64),
                1,
            )
            for channel in range(4):
                selected = factored["channel"] == channel
                offset_values[channel].extend(
                    map(int, factored["fineOffset"][selected])
                )
                residual_values[channel].extend(
                    map(int, factored["residualSamples"][selected])
                )
            split_events[track["split"]] += len(factored)
            cursor = end
            for key, value in audit.items():
                totals[key] += int(value)
        elif bar_end != bar_start:
            totals["ambiguousTracksWithBars"] += 1
        if (track_index + 1) % 400 == 0 or track_index + 1 == len(
            factor_tracks
        ):
            print(
                f"[fine timing {track_index + 1}/{len(factor_tracks)}] "
                f"events={cursor} "
                f"sampleErrors={totals['sampleRoundtripErrors']}",
                flush=True,
            )

    if cursor != total_events:
        totals["eventAllocationErrors"] += abs(total_events - cursor)
    fine_counts.flush()
    fine_events.flush()
    plan_event_counts = fine_counts.sum(axis=2, dtype=np.int64)
    plan_count_errors = int(
        np.count_nonzero(
            plan_event_counts != plans["eventCount"].astype(np.int64)
        )
    )
    anchor_errors = int(
        np.count_nonzero(
            anchor_counts
            != np.asarray(coarse_multiplicity, dtype=np.uint16)
        )
    )
    ornaments = (
        anchor_counts.sum(axis=2, dtype=np.int64)
        - np.count_nonzero(anchor_counts, axis=2)
    )
    ornament_errors = int(
        np.count_nonzero(
            ornaments
            != plans["ornamentEventCount"].astype(np.int64)
        )
    )
    bar_event_offsets = np.zeros(len(plans) + 1, dtype=np.int64)
    np.cumsum(bar_event_counts, out=bar_event_offsets[1:])
    bar_offsets_path = output / "fine-event-offsets.npy"
    np.save(bar_offsets_path, bar_event_offsets, allow_pickle=False)

    offset_distribution = {
        CHANNEL_NAMES[channel]: _quantiles(offset_values[channel])
        for channel in range(4)
    }
    residual_distribution = {
        CHANNEL_NAMES[channel]: _quantiles(residual_values[channel])
        for channel in range(4)
    }
    native_subslot_events = sum(
        sum(0 <= value <= 3 for value in channel_values)
        for channel_values in offset_values
    )
    fine_co_onsets = _same_slot_co_onsets(fine_counts)
    maximum_anchor = int(anchor_counts.max(initial=0))
    maximum_fine = int(fine_counts.max(initial=0))
    _close_memmap(fine_counts)
    _close_memmap(fine_events)
    _close_memmap(composition)
    _close_memmap(plans)
    _close_memmap(coarse_multiplicity)
    del (
        fine_counts,
        fine_events,
        composition,
        plans,
        coarse_multiplicity,
    )
    fine_partial.replace(fine_path)
    events_partial.replace(events_path)

    audit = {
        "schema": "chiptunes-gameboy-fine-timing-audit-v1",
        "factorizationFingerprint": factor_manifest[
            "contentFingerprint"
        ],
        "hierarchyFingerprint": hierarchy_manifest["contentFingerprint"],
        "tracks": len(factor_tracks),
        "qualifiedTracks": len(hierarchy_tracks),
        "bars": hierarchy_manifest["bars"],
        "events": total_events,
        "eventsBySplit": dict(sorted(split_events.items())),
        "fineOffsetByChannel": offset_distribution,
        "residualSamplesByChannel": residual_distribution,
        "nativeFourSubslotEventFraction": round(
            native_subslot_events / max(1, total_events),
            9,
        ),
        "maximumAnchorMultiplicity": maximum_anchor,
        "maximumFineSlotMultiplicity": maximum_fine,
        "sameFineSlotCoOnsets": fine_co_onsets.tolist(),
        "mappedEvents": totals["mappedEvents"],
        "unmappedEvents": totals["unmappedEvents"],
        "fineGridRoundtripErrors": totals["fineGridRoundtripErrors"],
        "sampleRoundtripErrors": totals["sampleRoundtripErrors"],
        "eventBarOrderErrors": totals["eventBarOrderErrors"],
        "anchorOffsetRegressions": totals["anchorOffsetRegressions"],
        "anchorMultiplicityErrors": anchor_errors,
        "planEventCountErrors": plan_count_errors,
        "planOrnamentCountErrors": ornament_errors,
        "ambiguousTracksWithBars": totals["ambiguousTracksWithBars"],
        "eventAllocationErrors": totals["eventAllocationErrors"],
    }
    audit["passed"] = (
        totals["mappedEvents"] == total_events
        and totals["unmappedEvents"] == 0
        and totals["fineGridRoundtripErrors"] == 0
        and totals["sampleRoundtripErrors"] == 0
        and totals["eventBarOrderErrors"] == 0
        and anchor_errors == 0
        and plan_count_errors == 0
        and ornament_errors == 0
        and totals["ambiguousTracksWithBars"] == 0
        and totals["eventAllocationErrors"] == 0
    )
    audit_path = output / "audit.json"
    _write_json(audit_path, audit)
    payload_hashes = {
        "fineMultiplicitySha256": _sha256_file(fine_path),
        "fineEventsSha256": _sha256_file(events_path),
        "fineEventOffsetsSha256": _sha256_file(bar_offsets_path),
        "auditSha256": _sha256_file(audit_path),
    }
    manifest = {
        "schema": "chiptunes-gameboy-fine-timing-dataset-v1",
        "factorizationFingerprint": factor_manifest[
            "contentFingerprint"
        ],
        "hierarchyFingerprint": hierarchy_manifest["contentFingerprint"],
        "tracks": len(factor_tracks),
        "qualifiedTracks": len(hierarchy_tracks),
        "bars": hierarchy_manifest["bars"],
        "events": total_events,
        "fineStepsPerBar": FINE_STEPS_PER_BAR,
        "fineEventDtype": FINE_EVENT_DTYPE.descr,
        "fineMultiplicityFile": fine_path.name,
        "fineEventsFile": events_path.name,
        "fineEventOffsetsFile": bar_offsets_path.name,
        "maximumAnchorMultiplicity": maximum_anchor,
        "maximumFineSlotMultiplicity": maximum_fine,
        **payload_hashes,
        "auditPassed": audit["passed"],
    }
    manifest["contentFingerprint"] = hashlib.sha256(
        (
            manifest["factorizationFingerprint"]
            + manifest["hierarchyFingerprint"]
            + "".join(payload_hashes.values())
        ).encode()
    ).hexdigest()
    _write_json(output / "manifest.json", manifest)
    print(
        json.dumps(
            {"manifest": manifest, "audit": audit},
            indent=2,
        ),
        flush=True,
    )
    if not audit["passed"]:
        raise RuntimeError("fine timing dataset audit failed")
    return manifest
