from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
from pathlib import Path

import numpy as np

from .extract import (
    FEATURE_NAMES,
    EXACT_EVENT_FIELDS,
    TRIGGER_STATE_FIELDS,
    REGISTER_WRITE_FIELDS,
    exact_event_rows,
    normalized_track_hash,
    parse_vgm,
    quantize_track,
    trigger_state_rows,
)


def _parse_job(args):
    path, root, max_seconds = args
    try:
        return parse_vgm(Path(path), Path(root), max_seconds)
    except Exception as exc:
        return {"error": f"{path}: {exc}"}


def _split(platform: str, soundtrack: str) -> str:
    value = int(hashlib.sha256(f"{platform}/{soundtrack}".encode()).hexdigest()[:8], 16) % 100
    return "train" if value < 80 else "validation" if value < 90 else "test"


def build_dataset(corpus: Path, output: Path, workers: int = 0, max_seconds: int = 0) -> dict:
    corpus = corpus.resolve()
    output.mkdir(parents=True, exist_ok=True)
    paths = sorted(
        path
        for platform in ("gameboy", "nes")
        for path in (corpus / platform).rglob("*")
        if path.suffix.lower() in (".vgm", ".vgz")
    )
    if not paths:
        raise RuntimeError(f"No VGM/VGZ files found under {corpus}/{{gameboy,nes}}")
    workers = workers or max(1, min(os.cpu_count() or 1, 8))
    jobs = [(str(path), str(corpus), max_seconds) for path in paths]
    patch_ids: dict[str, int] = {}
    seen: set[str] = set()
    tracks: list[dict] = []
    offsets = [0]
    register_offsets = [0]
    exact_event_offsets = [0]
    errors: list[str] = []
    duplicate_count = 0
    row_count = 0
    register_count = 0
    exact_event_count = 0
    trigger_state_count = 0
    binary = output / "features.i32"
    register_binary = output / "registers.i64"
    exact_event_binary = output / "exact-events.i64"
    trigger_state_binary = output / "trigger-states.u8"
    with (
        binary.open("wb") as stream,
        register_binary.open("wb") as register_stream,
        exact_event_binary.open("wb") as exact_event_stream,
        trigger_state_binary.open("wb") as trigger_state_stream,
        mp.get_context("spawn").Pool(workers) as pool,
    ):
        for index, result in enumerate(pool.imap(_parse_job, jobs, chunksize=8), 1):
            if isinstance(result, dict):
                errors.append(result["error"])
                continue
            if result is None:
                errors.append(f"{paths[index - 1]}: no supported channel events")
                continue
            features = quantize_track(result, patch_ids)
            digest = normalized_track_hash(features)
            if digest in seen:
                duplicate_count += 1
                continue
            seen.add(digest)
            array = np.asarray(features, dtype="<i4")
            stream.write(array.tobytes(order="C"))
            row_count += len(array)
            offsets.append(row_count)
            register_rows = np.asarray(
                [
                    (write.sample, write.address, write.value, write.order)
                    for write in result.register_writes
                ],
                dtype="<i8",
            ).reshape(-1, len(REGISTER_WRITE_FIELDS))
            register_stream.write(register_rows.tobytes(order="C"))
            register_count += len(register_rows)
            register_offsets.append(register_count)
            exact_rows = np.asarray(
                exact_event_rows(result, patch_ids),
                dtype="<i8",
            ).reshape(-1, len(EXACT_EVENT_FIELDS))
            exact_event_stream.write(exact_rows.tobytes(order="C"))
            exact_event_count += len(exact_rows)
            exact_event_offsets.append(exact_event_count)
            trigger_bytes = b"".join(trigger_state_rows(result))
            trigger_rows = np.frombuffer(trigger_bytes, dtype="u1").reshape(
                -1, len(TRIGGER_STATE_FIELDS)
            )
            if len(trigger_rows) != len(exact_rows):
                raise RuntimeError(
                    f"{result.source}: {len(trigger_rows)} trigger states for "
                    f"{len(exact_rows)} exact events"
                )
            trigger_state_stream.write(trigger_rows.tobytes(order="C"))
            trigger_state_count += len(trigger_rows)
            tracks.append(
                {
                    "source": result.source,
                    "platform": result.platform,
                    "soundtrack": result.soundtrack,
                    "split": _split(result.platform, result.soundtrack),
                    "bpm": result.bpm,
                    "duration": round(result.duration, 3),
                    "events": len(array),
                    "exactEvents": len(exact_rows),
                    "triggerStates": len(trigger_rows),
                    "registerWrites": len(register_rows),
                    "normalizedHash": digest,
                    "vgmVersion": result.vgm_version,
                    "headerTotalSamples": result.header_total_samples,
                    "commandSamples": result.command_samples,
                    "sampleCountDelta": result.command_samples - result.header_total_samples
                    if result.header_total_samples
                    else 0,
                    "loopOffset": result.loop_offset,
                    "loopStartSample": result.loop_start_sample,
                    "loopSamples": result.loop_samples,
                    "loopValid": result.loop_valid,
                    "loopKind": result.loop_kind,
                }
            )
            if index % 250 == 0 or index == len(paths):
                print(f"[extract {index}/{len(paths)}] tracks={len(tracks)} events={row_count} duplicates={duplicate_count}", flush=True)
    raw = np.memmap(binary, dtype="<i4", mode="r", shape=(row_count, len(FEATURE_NAMES)))
    np.save(output / "features.npy", raw)
    del raw
    binary.unlink()
    raw_registers = np.memmap(
        register_binary,
        dtype="<i8",
        mode="r",
        shape=(register_count, len(REGISTER_WRITE_FIELDS)),
    )
    np.save(output / "registers.npy", raw_registers)
    del raw_registers
    register_binary.unlink()
    raw_exact_events = np.memmap(
        exact_event_binary,
        dtype="<i8",
        mode="r",
        shape=(exact_event_count, len(EXACT_EVENT_FIELDS)),
    )
    np.save(output / "exact-events.npy", raw_exact_events)
    del raw_exact_events
    exact_event_binary.unlink()
    raw_trigger_states = np.memmap(
        trigger_state_binary,
        dtype="u1",
        mode="r",
        shape=(trigger_state_count, len(TRIGGER_STATE_FIELDS)),
    )
    np.save(output / "trigger-states.npy", raw_trigger_states)
    del raw_trigger_states
    trigger_state_binary.unlink()
    np.save(output / "offsets.npy", np.asarray(offsets, dtype="<i8"))
    np.save(output / "register-offsets.npy", np.asarray(register_offsets, dtype="<i8"))
    np.save(output / "exact-event-offsets.npy", np.asarray(exact_event_offsets, dtype="<i8"))
    patches = [None] * (len(patch_ids) + 1)
    patches[0] = {"type": "none"}
    for encoded, patch_id in patch_ids.items():
        patches[patch_id] = json.loads(encoded)
    (output / "patches.json").write_text(json.dumps(patches, separators=(",", ":")) + "\n")
    (output / "tracks.json").write_text(json.dumps(tracks, separators=(",", ":")) + "\n")
    manifest = {
        "schema": "chiptunes-symbolic-dataset-v1",
        "corpus": str(corpus),
        "sourceFiles": len(paths),
        "tracks": len(tracks),
        "duplicatesRemoved": duplicate_count,
        "errors": len(errors),
        "events": row_count,
        "registerWrites": register_count,
        "exactEvents": exact_event_count,
        "triggerStates": trigger_state_count,
        "features": list(FEATURE_NAMES),
        "registerFields": list(REGISTER_WRITE_FIELDS),
        "exactEventFields": list(EXACT_EVENT_FIELDS),
        "triggerStateFields": list(TRIGGER_STATE_FIELDS),
        "patches": len(patches) - 1,
        "splits": {name: sum(track["split"] == name for track in tracks) for name in ("train", "validation", "test")},
        "soundtracks": {
            name: len({(track["platform"], track["soundtrack"]) for track in tracks if track["split"] == name})
            for name in ("train", "validation", "test")
        },
        "contentFingerprint": hashlib.sha256(
            "\n".join(track["normalizedHash"] for track in tracks).encode()
        ).hexdigest(),
        "loops": {
            kind: sum(track["loopKind"] == kind for track in tracks)
            for kind in ("none", "intro-plus-loop", "loop-from-start", "invalid")
        },
        "headerSampleCountMismatches": sum(
            bool(track["headerTotalSamples"]) and track["sampleCountDelta"] != 0
            for track in tracks
        ),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "errors.txt").write_text("\n".join(errors) + ("\n" if errors else ""))
    print(json.dumps(manifest, indent=2))
    return manifest
