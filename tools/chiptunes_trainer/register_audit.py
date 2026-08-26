from __future__ import annotations

import json
from pathlib import Path

import numpy as np


TRIGGER_ADDRESSES = (0x04, 0x09, 0x0E, 0x13)
WAVE_RAM_START = 0x20
WAVE_RAM_END = 0x2F
MASTER_ADDRESSES = (0x14, 0x15, 0x16)
GAMEBOY_REGISTER_COUNT = 0x30
GAMEBOY_REGISTER_MASK_BYTES = GAMEBOY_REGISTER_COUNT // 8


def audit_register_dataset(dataset: Path, output: Path) -> dict:
    registers = np.load(dataset / "registers.npy", mmap_mode="r")
    offsets = np.load(dataset / "register-offsets.npy", mmap_mode="r")
    tracks = json.loads((dataset / "tracks.json").read_text())
    if len(offsets) != len(tracks) + 1:
        raise RuntimeError("register offsets do not align with tracks")
    address_counts = np.zeros(256, dtype=np.int64)
    invalid_order_tracks = []
    nonmonotonic_sample_tracks = []
    sample_overrun_tracks = []
    empty_tracks = []
    loop_region_writes = 0
    intro_region_writes = 0
    maximum_same_sample_writes = 0
    trigger_writes = [0, 0, 0, 0]
    wave_ram_writes = 0
    master_writes = 0
    exact_path = dataset / "exact-events.npy"
    exact_offsets_path = dataset / "exact-event-offsets.npy"
    exact_events = np.load(exact_path, mmap_mode="r") if exact_path.exists() else None
    exact_offsets = np.load(exact_offsets_path, mmap_mode="r") if exact_offsets_path.exists() else None
    exact_invalid_order = []
    exact_nonmonotonic = []
    exact_sample_overrun = []
    exact_invalid_channel = []
    exact_missing_trigger = []
    exact_invalid_register_order = []
    exact_trigger_state_mismatch = []
    exact_by_channel = np.zeros(4, dtype=np.int64)
    trigger_states_path = dataset / "trigger-states.npy"
    trigger_states = (
        np.load(trigger_states_path, mmap_mode="r") if trigger_states_path.exists() else None
    )
    if exact_events is not None and (exact_offsets is None or len(exact_offsets) != len(tracks) + 1):
        raise RuntimeError("exact-event offsets do not align with tracks")
    if trigger_states is not None and (
        exact_events is None
        or trigger_states.shape != (len(exact_events), GAMEBOY_REGISTER_COUNT + GAMEBOY_REGISTER_MASK_BYTES)
    ):
        raise RuntimeError("trigger states do not align with exact events")

    for index, track in enumerate(tracks):
        rows = np.asarray(registers[int(offsets[index]) : int(offsets[index + 1])])
        if not len(rows):
            empty_tracks.append(track["source"])
            continue
        samples, addresses, values, order = rows.T
        address_counts += np.bincount(addresses, minlength=256)
        if not np.array_equal(order, np.arange(len(rows))):
            invalid_order_tracks.append(track["source"])
        if np.any(np.diff(samples) < 0):
            nonmonotonic_sample_tracks.append(track["source"])
        if int(samples[-1]) > int(track["commandSamples"]):
            sample_overrun_tracks.append(track["source"])
        _, same_sample_counts = np.unique(samples, return_counts=True)
        maximum_same_sample_writes = max(maximum_same_sample_writes, int(same_sample_counts.max()))
        for channel, address in enumerate(TRIGGER_ADDRESSES):
            trigger_writes[channel] += int(((addresses == address) & ((values & 0x80) != 0)).sum())
        wave_ram_writes += int(((addresses >= WAVE_RAM_START) & (addresses <= WAVE_RAM_END)).sum())
        master_writes += int(np.isin(addresses, MASTER_ADDRESSES).sum())
        loop_start = track.get("loopStartSample")
        if track.get("loopValid") and loop_start is not None:
            intro_region_writes += int((samples < int(loop_start)).sum())
            loop_region_writes += int((samples >= int(loop_start)).sum())
        if exact_events is not None:
            event_rows = np.asarray(
                exact_events[int(exact_offsets[index]) : int(exact_offsets[index + 1])]
            )
            (
                event_samples,
                event_channels,
                _,
                _,
                _,
                _,
                event_order,
                event_register_order,
            ) = event_rows.T
            valid_event_channels = event_channels[(event_channels >= 0) & (event_channels < 4)]
            exact_by_channel += np.bincount(valid_event_channels, minlength=4)
            if not np.array_equal(event_order, np.arange(len(event_rows))):
                exact_invalid_order.append(track["source"])
            if np.any(np.diff(event_samples) < 0):
                exact_nonmonotonic.append(track["source"])
            if len(event_rows) and int(event_samples[-1]) > int(track["commandSamples"]):
                exact_sample_overrun.append(track["source"])
            if np.any((event_channels < 0) | (event_channels >= 4)):
                exact_invalid_channel.append(track["source"])
            trigger_pairs = set()
            for channel, address in enumerate(TRIGGER_ADDRESSES):
                trigger_pairs.update(
                    (int(trigger_sample), channel)
                    for trigger_sample in samples[
                        (addresses == address) & ((values & 0x80) != 0)
                    ]
                )
            if any(
                (int(event_sample), int(event_channel)) not in trigger_pairs
                for event_sample, event_channel in zip(event_samples, event_channels)
            ):
                exact_missing_trigger.append(track["source"])
            expected_addresses = np.asarray(
                [
                    TRIGGER_ADDRESSES[int(channel)]
                    if 0 <= int(channel) < len(TRIGGER_ADDRESSES)
                    else -1
                    for channel in event_channels
                ],
                dtype=np.int64,
            )
            valid_register_order = (
                (event_register_order >= 0)
                & (event_register_order < len(rows))
                & (expected_addresses >= 0)
            )
            if (
                not np.all(valid_register_order)
                or np.any(samples[event_register_order[valid_register_order]] != event_samples[valid_register_order])
                or np.any(addresses[event_register_order[valid_register_order]] != expected_addresses[valid_register_order])
                or np.any((values[event_register_order[valid_register_order]] & 0x80) == 0)
            ):
                exact_invalid_register_order.append(track["source"])
            if trigger_states is not None and len(event_rows):
                state_rows = np.asarray(
                    trigger_states[int(exact_offsets[index]) : int(exact_offsets[index + 1])]
                )
                valid_indices = np.flatnonzero(valid_register_order)
                trigger_addresses = expected_addresses[valid_indices]
                state_values = state_rows[valid_indices, trigger_addresses]
                state_masks = state_rows[
                    valid_indices,
                    GAMEBOY_REGISTER_COUNT + trigger_addresses // 8,
                ]
                expected_values = values[event_register_order[valid_indices]]
                known_bits = 1 << (trigger_addresses % 8)
                if (
                    np.any(state_values != expected_values)
                    or np.any((state_masks & known_bits) == 0)
                ):
                    exact_trigger_state_mismatch.append(track["source"])

    exact_event_report = None
    if exact_events is not None:
        exact_event_report = {
            "events": int(len(exact_events)),
            "eventsByChannel": dict(
                zip(("pulse1", "pulse2", "wave", "noise"), map(int, exact_by_channel))
            ),
            "invalidOrderTracks": len(exact_invalid_order),
            "nonmonotonicSampleTracks": len(exact_nonmonotonic),
            "sampleOverrunTracks": len(exact_sample_overrun),
            "invalidChannelTracks": len(exact_invalid_channel),
            "eventsWithoutMatchingTriggerTracks": len(exact_missing_trigger),
            "invalidRegisterOrderTracks": len(exact_invalid_register_order),
            "triggerStateMismatchTracks": len(exact_trigger_state_mismatch),
            "triggerStates": int(len(trigger_states)) if trigger_states is not None else 0,
        }
    report = {
        "schema": "chiptunes-gameboy-register-audit-v1",
        "dataset": str(dataset.resolve()),
        "tracks": len(tracks),
        "registerWrites": int(len(registers)),
        "tracksWithNoRegisterWrites": len(empty_tracks),
        "invalidOrderTracks": len(invalid_order_tracks),
        "nonmonotonicSampleTracks": len(nonmonotonic_sample_tracks),
        "sampleOverrunTracks": len(sample_overrun_tracks),
        "maximumSameSampleWrites": maximum_same_sample_writes,
        "triggerWritesByChannel": dict(
            zip(("pulse1", "pulse2", "wave", "noise"), trigger_writes)
        ),
        "waveRamWrites": wave_ram_writes,
        "masterControlWrites": master_writes,
        "introRegionWrites": intro_region_writes,
        "loopRegionWrites": loop_region_writes,
        "addressCounts": {
            f"0x{address:02X}": int(count)
            for address, count in enumerate(address_counts)
            if count
        },
        "exactEvents": exact_event_report,
        "examples": {
            "emptyTracks": empty_tracks[:10],
            "invalidOrderTracks": invalid_order_tracks[:10],
            "nonmonotonicSampleTracks": nonmonotonic_sample_tracks[:10],
            "sampleOverrunTracks": sample_overrun_tracks[:10],
            "exactInvalidOrderTracks": exact_invalid_order[:10],
            "exactNonmonotonicSampleTracks": exact_nonmonotonic[:10],
            "exactSampleOverrunTracks": exact_sample_overrun[:10],
            "exactInvalidChannelTracks": exact_invalid_channel[:10],
            "exactMissingTriggerTracks": exact_missing_trigger[:10],
            "exactInvalidRegisterOrderTracks": exact_invalid_register_order[:10],
            "exactTriggerStateMismatchTracks": exact_trigger_state_mismatch[:10],
        },
        "passed": not (
            empty_tracks
            or invalid_order_tracks
            or nonmonotonic_sample_tracks
            or sample_overrun_tracks
            or exact_invalid_order
            or exact_nonmonotonic
            or exact_sample_overrun
            or exact_invalid_channel
            or exact_missing_trigger
            or exact_invalid_register_order
            or exact_trigger_state_mismatch
        ),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    if not report["passed"]:
        raise RuntimeError("register dataset audit failed")
    return report
