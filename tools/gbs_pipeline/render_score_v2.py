"""Reconstruct a Standard MIDI File from a canonical score-v2 record.

The writer uses the retained raw event streams, not the quantized compound
pilot. Running status and note-off spelling may normalize, but every audible
channel/meta/SysEx event keeps its source tick, track, and within-track order.
Reparsing the result must reproduce the canonical score hash.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Sequence

from midi_score_v2 import parse_smf, read_score


def write_vlq(value: int) -> bytes:
    if not 0 <= value <= 0x0FFFFFFF:
        raise ValueError(f"VLQ value out of range: {value}")
    output = [value & 0x7F]
    value >>= 7
    while value:
        output.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(output))


def _division_bytes(division: dict[str, Any]) -> bytes:
    if division["type"] == "ppq":
        value = division["ticksPerQuarter"]
        if not 1 <= value <= 0x7FFF:
            raise ValueError(f"invalid PPQ division {value}")
        return value.to_bytes(2, "big")
    if division["type"] != "smpte":
        raise ValueError(f"unknown division type {division.get('type')}")
    fps = division["fpsCode"]
    ticks = division["ticksPerFrame"]
    if fps not in (24, 25, 29, 30) or not 1 <= ticks <= 255:
        raise ValueError("invalid SMPTE division")
    return bytes(((256 - fps) & 0xFF, ticks))


def _channel(status: int, row: dict[str, Any], data: Sequence[int]) -> bytes:
    channel = row["channel"]
    if not 0 <= channel <= 15 or any(not 0 <= value <= 127 for value in data):
        raise ValueError("invalid canonical channel event")
    return bytes((status | channel, *data))


def _raw_events(score: dict[str, Any]) -> list[list[tuple[int, int, bytes]]]:
    track_count = score["source"]["declaredTracks"]
    tracks: list[list[tuple[int, int, bytes]]] = [
        [] for _ in range(track_count)]

    def add(row: dict[str, Any], body: bytes) -> None:
        track = row["track"]
        if not 0 <= track < track_count:
            raise ValueError(f"event references unknown track {track}")
        tracks[track].append((row["tick"], row.get("order", 0), body))

    for row in score["metaEvents"]:
        payload = bytes.fromhex(row["dataHex"])
        add(row, bytes((0xFF, row["metaType"]))
            + write_vlq(len(payload)) + payload)
    for row in score["sysex"]:
        payload = bytes.fromhex(row["dataHex"])
        add(row, bytes((row["status"],)) + write_vlq(len(payload)) + payload)
    for row in score["noteEvents"]:
        status = 0x90 if row["kind"] == "on" else 0x80
        add(row, _channel(status, row, (row["pitch"], row["velocity"])))
    for row in score["controls"]:
        add(row, _channel(0xB0, row, (row["controller"], row["value"])))
    for row in score["programChanges"]:
        add(row, _channel(0xC0, row, (row["program"],)))
    for row in score["pitchBends"]:
        value = row["value"] + 8192
        if not 0 <= value <= 16383:
            raise ValueError(f"pitch bend out of range: {row['value']}")
        add(row, _channel(0xE0, row, (value & 0x7F, value >> 7)))
    for row in score["polyPressure"]:
        add(row, _channel(0xA0, row, (row["pitch"], row["value"])))
    for row in score["channelPressure"]:
        add(row, _channel(0xD0, row, (row["value"],)))
    return tracks


def score_to_smf(score: dict[str, Any]) -> bytes:
    midi_format = score["source"]["format"]
    track_count = score["source"]["declaredTracks"]
    if midi_format not in (0, 1) or track_count < 1 \
            or midi_format == 0 and track_count != 1:
        raise ValueError("invalid canonical SMF header")
    header_data = (midi_format.to_bytes(2, "big")
                   + track_count.to_bytes(2, "big")
                   + _division_bytes(score["division"]))
    chunks = [b"MThd" + len(header_data).to_bytes(4, "big") + header_data]
    tracks = _raw_events(score)
    for track_index, rows in enumerate(tracks):
        rows.sort(key=lambda item: (item[0], item[1]))
        has_end = any(body[:2] == b"\xff\x2f" for _, _, body in rows)
        if not has_end:
            rows.append((score["trackEndTicks"][track_index], 1 << 30,
                         b"\xff\x2f\x00"))
            rows.sort(key=lambda item: (item[0], item[1]))
        payload = bytearray()
        previous_tick = 0
        for tick, _, body in rows:
            if tick < previous_tick:
                raise ValueError("canonical track events moved backwards")
            payload.extend(write_vlq(tick - previous_tick))
            payload.extend(body)
            previous_tick = tick
        chunks.append(b"MTrk" + len(payload).to_bytes(4, "big") + payload)
    return b"".join(chunks)


def verified_score_to_smf(score: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    payload = score_to_smf(score)
    reparsed = parse_smf(payload, "roundtrip.mid")
    expected = score["canonicalScoreSha256"]
    actual = reparsed["canonicalScoreSha256"]
    if actual != expected:
        raise ValueError(
            f"canonical MIDI roundtrip mismatch: expected={expected} actual={actual}")
    return payload, reparsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    score = read_score(args.input)
    payload, reparsed = verified_score_to_smf(score)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(json.dumps({
        "sourceCanonicalScoreSha256": score["canonicalScoreSha256"],
        "roundtripCanonicalScoreSha256": reparsed["canonicalScoreSha256"],
        "bytes": len(payload),
        "statistics": reparsed["statistics"],
        "output": str(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
