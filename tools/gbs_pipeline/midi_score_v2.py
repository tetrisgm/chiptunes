"""Full-fidelity Standard MIDI File -> canonical score-v2 records.

This module replaces the retired onset-only MIDI reducer.  It preserves the
complete symbolic score needed for MIDI-only pretraining:

* paired note-on/note-off events with key and sounding durations;
* sustain-pedal semantics;
* every track, channel, simultaneous note, program, drum, and velocity;
* tempo, meter, key, controllers, pitch bend, pressure, metadata, and SysEx.

The canonical score is deterministic compressed JSON. canonicalScoreSha256
hashes sound-affecting musical content rather than filenames or text metadata,
so source copies with different names can be deduplicated later.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA = "chiptunes-score-v2"


class MidiParseError(ValueError):
    """The input is not a supported, structurally valid SMF."""


def _u16(data: bytes, offset: int) -> int:
    if offset + 2 > len(data):
        raise MidiParseError("truncated uint16")
    return int.from_bytes(data[offset:offset + 2], "big")


def _u32(data: bytes, offset: int) -> int:
    if offset + 4 > len(data):
        raise MidiParseError("truncated uint32")
    return int.from_bytes(data[offset:offset + 4], "big")


def read_vlq(data: bytes, offset: int, end: int | None = None) -> tuple[int, int]:
    """Read one SMF variable-length quantity, failing on truncation/overflow."""
    limit = len(data) if end is None else min(end, len(data))
    value = 0
    for _ in range(4):
        if offset >= limit:
            raise MidiParseError("truncated VLQ")
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, offset
    raise MidiParseError("VLQ exceeds four bytes")


def _text(payload: bytes) -> str:
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding).replace("\x00", "").strip()
        except UnicodeDecodeError:
            pass
    return payload.decode("latin-1", errors="replace").replace("\x00", "").strip()


def _division(raw: int) -> dict[str, Any]:
    if raw == 0:
        raise MidiParseError("division is zero")
    if not raw & 0x8000:
        return {"type": "ppq", "ticksPerQuarter": raw}
    signed = ((raw >> 8) & 0xFF) - 256
    fps_code = -signed
    ticks_per_frame = raw & 0xFF
    if fps_code not in (24, 25, 29, 30) or ticks_per_frame == 0:
        raise MidiParseError(
            f"invalid SMPTE division fps={fps_code} ticks={ticks_per_frame}")
    numerator, denominator = ((30000, 1001) if fps_code == 29
                              else (fps_code, 1))
    return {
        "type": "smpte",
        "fpsCode": fps_code,
        "framesPerSecondNumerator": numerator,
        "framesPerSecondDenominator": denominator,
        "ticksPerFrame": ticks_per_frame,
    }


def _event(track: int, tick: int, **values: Any) -> dict[str, Any]:
    return {"tick": tick, "track": track, **values}


def _close_note(note: dict[str, Any], key_end: int, sounding_end: int,
                notes: list[dict[str, Any]]) -> None:
    note["keyEnd"] = max(note["start"], key_end)
    note["end"] = max(note["keyEnd"], sounding_end)
    notes.append(note)


def _parse_track(payload: bytes, track: int,
                 output: dict[str, list[dict[str, Any]]],
                 issues: collections.Counter[str]) -> int:
    offset = 0
    tick = 0
    running: int | None = None
    port = 0
    order = 0

    while offset < len(payload):
        delta, offset = read_vlq(payload, offset)
        tick += delta
        if offset >= len(payload):
            raise MidiParseError(f"track {track}: event missing after delta")
        status = payload[offset]
        if status & 0x80:
            offset += 1
            if status < 0xF0:
                running = status
            else:
                running = None
        elif running is not None:
            status = running
        else:
            raise MidiParseError(f"track {track}: running status without status")

        if status == 0xFF:
            if offset >= len(payload):
                raise MidiParseError(f"track {track}: truncated meta event")
            meta_type = payload[offset]
            offset += 1
            length, offset = read_vlq(payload, offset, len(payload))
            if offset + length > len(payload):
                raise MidiParseError(f"track {track}: truncated meta payload")
            body = payload[offset:offset + length]
            offset += length
            output["metaEvents"].append(
                _event(track, tick, order=order, metaType=meta_type,
                       dataHex=body.hex()))
            if meta_type == 0x03:
                output["trackNames"].append(
                    _event(track, tick, order=order, name=_text(body)))
            elif meta_type == 0x51:
                if len(body) == 3 and int.from_bytes(body, "big") > 0:
                    output["tempos"].append(_event(
                        track, tick, order=order,
                        microsecondsPerQuarter=int.from_bytes(body, "big")))
                else:
                    issues["invalidTempoMeta"] += 1
            elif meta_type == 0x58:
                # A zero numerator is not a usable MIDI meter. Keep the
                # malformed event in the source audit's rejection accounting,
                # but do not emit it into the score where the compound grid
                # would fail later with an uncategorized exception.
                if len(body) >= 4 and 1 <= body[0] <= 255 \
                        and body[1] <= 7:
                    output["timeSignatures"].append(_event(
                        track, tick, order=order, numerator=body[0],
                        denominator=1 << body[1],
                        clocksPerClick=body[2],
                        thirtySecondsPerQuarter=body[3]))
                else:
                    issues["invalidTimeSignatureMeta"] += 1
            elif meta_type == 0x59:
                if len(body) >= 2:
                    sharps = int.from_bytes(body[:1], "big", signed=True)
                    output["keySignatures"].append(_event(
                        track, tick, order=order, sharps=sharps,
                        minor=bool(body[1])))
                else:
                    issues["invalidKeySignatureMeta"] += 1
            elif meta_type == 0x21:
                if len(body) == 1 and body[0] < 128:
                    port = body[0]
                    output["midiPorts"].append(
                        _event(track, tick, order=order, port=port))
                else:
                    issues["invalidMidiPortMeta"] += 1
            order += 1
            if meta_type == 0x2F:
                break
            continue

        if status in (0xF0, 0xF7):
            length, offset = read_vlq(payload, offset, len(payload))
            if offset + length > len(payload):
                raise MidiParseError(f"track {track}: truncated SysEx payload")
            body = payload[offset:offset + length]
            offset += length
            output["sysex"].append(
                _event(track, tick, order=order, port=port, status=status,
                       dataHex=body.hex()))
            order += 1
            continue
        if status >= 0xF0:
            raise MidiParseError(
                f"track {track}: unsupported system status 0x{status:02x}")

        kind = status >> 4
        channel = status & 0x0F
        needed = 1 if kind in (0xC, 0xD) else 2
        if offset + needed > len(payload):
            raise MidiParseError(f"track {track}: truncated channel event")
        first = payload[offset]
        second = payload[offset + 1] if needed == 2 else None
        if first & 0x80 or (second is not None and second & 0x80):
            raise MidiParseError(
                f"track {track}: invalid channel data byte at offset "
                f"{offset} tick {tick} status 0x{status:02x} "
                f"data=0x{first:02x}"
                + (f",0x{second:02x}" if second is not None else ""))
        offset += needed

        event_values = {
            "order": order, "port": port, "channel": channel,
        }
        if kind == 0x9 and second:
            output["noteEvents"].append(_event(
                track, tick, **event_values, kind="on", pitch=first,
                velocity=second))
        elif kind == 0x8 or (kind == 0x9 and second == 0):
            output["noteEvents"].append(_event(
                track, tick, **event_values, kind="off", pitch=first,
                velocity=second))
        elif kind == 0xB:
            output["controls"].append(
                _event(track, tick, **event_values,
                       controller=first, value=second))
        elif kind == 0xC:
            output["programChanges"].append(
                _event(track, tick, **event_values, program=first))
        elif kind == 0xE:
            value = first | (second << 7)
            output["pitchBends"].append(
                _event(track, tick, **event_values, value=value - 8192))
        elif kind == 0xA:
            output["polyPressure"].append(
                _event(track, tick, **event_values,
                       pitch=first, value=second))
        elif kind == 0xD:
            output["channelPressure"].append(
                _event(track, tick, **event_values, value=first))
        order += 1
    return tick


def _resolve_notes(output: dict[str, list[dict[str, Any]]],
                   issues: collections.Counter[str]) -> None:
    """Resolve note lifetimes using playback-wide port/channel state.

    Format-1 tracks are simultaneous streams sent to the same MIDI ports.
    Program, sustain, and note state therefore cannot be reset per track. Raw
    note events remain in the canonical score even when their pairing is
    malformed; only successfully paired notes enter ``notes``.
    """
    programs: dict[tuple[int, int], int] = collections.defaultdict(int)
    bank_msb: dict[tuple[int, int], int] = collections.defaultdict(int)
    bank_lsb: dict[tuple[int, int], int] = collections.defaultdict(int)
    sustain: dict[tuple[int, int], bool] = collections.defaultdict(bool)
    open_notes: dict[tuple[int, int, int], list[dict[str, Any]]] = \
        collections.defaultdict(list)
    sustained: dict[tuple[int, int], list[dict[str, Any]]] = \
        collections.defaultdict(list)
    events: list[tuple[str, dict[str, Any]]] = []
    events.extend(("note", row) for row in output["noteEvents"])
    events.extend(("program", row) for row in output["programChanges"])
    events.extend(("control", row) for row in output["controls"])
    events.sort(key=lambda item: (
        item[1]["tick"], item[1]["track"], item[1]["order"]))

    for event_type, row in events:
        channel_key = (row["port"], row["channel"])
        if event_type == "program":
            programs[channel_key] = row["program"]
            continue
        if event_type == "control":
            controller = row["controller"]
            tick = row["tick"]
            if controller == 0:
                bank_msb[channel_key] = row["value"]
            elif controller == 32:
                bank_lsb[channel_key] = row["value"]
            elif controller == 64:
                down = row["value"] >= 64
                if sustain[channel_key] and not down:
                    for note in sustained.pop(channel_key, []):
                        _close_note(note, note["keyEnd"], tick,
                                    output["notes"])
                sustain[channel_key] = down
            elif controller == 120:  # All Sound Off.
                for (port, channel, _), stack in open_notes.items():
                    if (port, channel) == channel_key:
                        while stack:
                            _close_note(stack.pop(), tick, tick,
                                        output["notes"])
                for note in sustained.pop(channel_key, []):
                    _close_note(note, note["keyEnd"], tick, output["notes"])
            elif controller == 123:  # All Notes Off; pedal still holds.
                for (port, channel, _), stack in open_notes.items():
                    if (port, channel) != channel_key:
                        continue
                    while stack:
                        note = stack.pop()
                        if sustain[channel_key]:
                            note["keyEnd"] = max(note["start"], tick)
                            sustained[channel_key].append(note)
                        else:
                            _close_note(note, tick, tick, output["notes"])
            elif controller == 121:  # Reset All Controllers.
                for note in sustained.pop(channel_key, []):
                    _close_note(note, note["keyEnd"], tick, output["notes"])
                sustain[channel_key] = False
            continue

        note_key = (*channel_key, row["pitch"])
        if row["kind"] == "on":
            open_notes[note_key].append({
                "start": row["tick"], "track": row["track"],
                "port": row["port"], "channel": row["channel"],
                "pitch": row["pitch"], "velocity": row["velocity"],
                "program": programs[channel_key],
                "bankMsb": bank_msb[channel_key],
                "bankLsb": bank_lsb[channel_key],
                "drum": row["channel"] == 9,
            })
            continue
        stack = open_notes[note_key]
        if not stack:
            issues["orphanNoteOffs"] += 1
            continue
        note = stack.pop()
        if sustain[channel_key]:
            note["keyEnd"] = max(note["start"], row["tick"])
            sustained[channel_key].append(note)
        else:
            _close_note(note, row["tick"], row["tick"], output["notes"])

    unterminated_notes = sum(len(stack) for stack in open_notes.values())
    unterminated_sustain = sum(len(notes) for notes in sustained.values())
    if unterminated_notes:
        issues["unterminatedNotes"] += unterminated_notes
    if unterminated_sustain:
        issues["unterminatedSustain"] += unterminated_sustain


def _sorted_rows(rows: list[dict[str, Any]], fields: tuple[str, ...]
                 ) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: tuple(row.get(field, 0)
                                               for field in fields))


def canonical_payload(score: dict[str, Any]) -> dict[str, Any]:
    """Return only sound-affecting fields used by the exact score hash."""
    sound_fields = (
        "noteEvents", "programChanges", "controls", "pitchBends",
        "polyPressure", "channelPressure", "sysex")
    orders: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    for field in sound_fields:
        for row in score[field]:
            orders[(row["track"], row["tick"])].append(row.get("order", 0))
    order_rank = {
        key: {value: rank for rank, value in enumerate(sorted(set(values)))}
        for key, values in orders.items()
    }

    def normalized(field: str, *, cross_sound: bool = True
                   ) -> list[dict[str, Any]]:
        rows = []
        local_orders: dict[tuple[int, int], dict[int, int]] = {}
        if not cross_sound:
            by_time: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
            for row in score[field]:
                by_time[(row["track"], row["tick"])].append(row.get("order", 0))
            local_orders = {
                key: {value: rank for rank, value in enumerate(sorted(set(values)))}
                for key, values in by_time.items()
            }
        for source in score[field]:
            row = dict(source)
            key = (row["track"], row["tick"])
            mapping = order_rank[key] if cross_sound else local_orders[key]
            row["order"] = mapping[row.get("order", 0)]
            rows.append(row)
        return rows

    return {
        "division": score["division"],
        "noteEvents": normalized("noteEvents"),
        "notes": score["notes"],
        "tempos": normalized("tempos", cross_sound=False),
        "timeSignatures": normalized("timeSignatures", cross_sound=False),
        "keySignatures": normalized("keySignatures", cross_sound=False),
        "programChanges": normalized("programChanges"),
        "controls": normalized("controls"),
        "pitchBends": normalized("pitchBends"),
        "polyPressure": normalized("polyPressure"),
        "channelPressure": normalized("channelPressure"),
        "sysex": normalized("sysex"),
    }


def canonical_sha256(score: dict[str, Any]) -> str:
    encoded = json.dumps(canonical_payload(score), sort_keys=True,
                         separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _max_polyphony(notes: list[dict[str, Any]]) -> int:
    points = []
    for note in notes:
        if note["end"] > note["start"]:
            points.extend(((note["start"], 1), (note["end"], -1)))
    active = high = 0
    for _, change in sorted(points, key=lambda point: (point[0], point[1])):
        active += change
        high = max(high, active)
    return high


def parse_smf(data: bytes, source_name: str | None = None) -> dict[str, Any]:
    """Parse one SMF format 0/1 file into a deterministic score-v2 object."""
    if len(data) < 14 or data[:4] != b"MThd":
        raise MidiParseError("missing MThd")
    header_length = _u32(data, 4)
    if header_length < 6 or 8 + header_length > len(data):
        raise MidiParseError("invalid MThd length")
    midi_format = _u16(data, 8)
    declared_tracks = _u16(data, 10)
    raw_division = _u16(data, 12)
    if midi_format not in (0, 1):
        raise MidiParseError(f"unsupported SMF format {midi_format}")
    if declared_tracks < 1:
        raise MidiParseError("SMF must declare at least one track")
    if midi_format == 0 and declared_tracks != 1:
        raise MidiParseError("format 0 must declare exactly one track")

    names = (
        "noteEvents", "notes", "tempos", "timeSignatures", "keySignatures",
        "programChanges", "controls", "pitchBends", "polyPressure",
        "channelPressure", "trackNames", "midiPorts", "metaEvents", "sysex")
    output: dict[str, list[dict[str, Any]]] = {name: [] for name in names}
    issues: collections.Counter[str] = collections.Counter()
    offset = 8 + header_length
    parsed_tracks = 0
    track_ends = []
    while offset + 8 <= len(data) and parsed_tracks < declared_tracks:
        chunk_type = data[offset:offset + 4]
        chunk_length = _u32(data, offset + 4)
        offset += 8
        if offset + chunk_length > len(data):
            raise MidiParseError("truncated chunk")
        payload = data[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type != b"MTrk":
            issues["nonTrackChunks"] += 1
            continue
        track_ends.append(_parse_track(
            payload, parsed_tracks, output, issues))
        parsed_tracks += 1
    if parsed_tracks != declared_tracks:
        raise MidiParseError(
            f"declared {declared_tracks} tracks but parsed {parsed_tracks}")
    _resolve_notes(output, issues)

    sort_specs = {
        "noteEvents": ("tick", "track", "order"),
        "notes": ("start", "track", "port", "channel", "pitch",
                  "keyEnd", "end"),
        "tempos": ("tick", "track", "order"),
        "timeSignatures": ("tick", "track", "order"),
        "keySignatures": ("tick", "track", "order"),
        "programChanges": ("tick", "track", "order"),
        "controls": ("tick", "track", "order"),
        "pitchBends": ("tick", "track", "order"),
        "polyPressure": ("tick", "track", "order"),
        "channelPressure": ("tick", "track", "order"),
        "trackNames": ("track", "tick", "order"),
        "midiPorts": ("track", "tick", "order"),
        "metaEvents": ("track", "tick", "order"),
        "sysex": ("track", "tick", "order"),
    }
    for name, fields in sort_specs.items():
        output[name] = _sorted_rows(output[name], fields)

    score: dict[str, Any] = {
        "schema": SCHEMA,
        "source": {
            "name": source_name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "format": midi_format,
            "declaredTracks": declared_tracks,
        },
        "division": _division(raw_division),
        **output,
        "trackEndTicks": track_ends,
        "issues": dict(sorted(issues.items())),
    }
    score["statistics"] = {
        "notes": len(score["notes"]),
        "noteEvents": len(score["noteEvents"]),
        "noteOns": sum(row["kind"] == "on"
                        for row in score["noteEvents"]),
        "noteOffs": sum(row["kind"] == "off"
                         for row in score["noteEvents"]),
        "tracks": parsed_tracks,
        "parts": len({(row["track"], row["port"], row["channel"])
                      for row in score["notes"]}),
        "channels": len({(row["port"], row["channel"])
                         for row in score["notes"]}),
        "durationTicks": max(track_ends, default=0),
        "maxPolyphony": _max_polyphony(score["notes"]),
        "drumNotes": sum(bool(row["drum"]) for row in score["notes"]),
    }
    score["canonicalScoreSha256"] = canonical_sha256(score)
    return score


def score_bytes(score: dict[str, Any]) -> bytes:
    encoded = json.dumps(score, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    return gzip.compress(encoded, compresslevel=9, mtime=0)


def write_score(path: str | Path, score: dict[str, Any]) -> None:
    Path(path).write_bytes(score_bytes(score))


def read_score(path: str | Path) -> dict[str, Any]:
    payload = Path(path).read_bytes()
    if payload[:2] == b"\x1f\x8b":
        payload = gzip.decompress(payload)
    score = json.loads(payload.decode("utf-8"))
    if score.get("schema") != SCHEMA:
        raise MidiParseError(f"not {SCHEMA}")
    expected = score.get("canonicalScoreSha256")
    actual = canonical_sha256(score)
    if expected != actual:
        raise MidiParseError(
            f"canonical hash mismatch: stored={expected} actual={actual}")
    return score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    score = parse_smf(args.input.read_bytes(), args.input.name)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_score(args.output, score)
    print(json.dumps({
        "schema": score["schema"],
        "source": score["source"],
        "canonicalScoreSha256": score["canonicalScoreSha256"],
        "statistics": score["statistics"],
        "issues": score["issues"],
        "output": str(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
