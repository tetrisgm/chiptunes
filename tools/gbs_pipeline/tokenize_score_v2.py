"""Compound 96-PPQ representation for full-score MIDI pretraining.

One sequence element carries all factors for one musical event. BAR and BEAT
markers make meter explicit, while notes keep part, program family, pitch,
duration, and velocity adjacent. Time is losslessly decodable at the chosen
96-PPQ grid, including meter changes that occur mid-bar.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
from pathlib import Path
from statistics import median
from typing import Any, Sequence

from audit_score_v2 import ScoreTimeMap
from midi_score_v2 import read_score


COMPOUND_SCHEMA = "chiptunes-score-v2-compound-v1"
EVENT_KINDS = {
    "BOS": 1,
    "METER": 2,
    "BAR": 3,
    "BEAT": 4,
    "TEMPO": 5,
    "KEY": 6,
    "NOTE": 7,
    "CONTROL": 8,
    "BEND": 9,
    "POLY_PRESSURE": 10,
    "CHANNEL_PRESSURE": 11,
    "EOS": 12,
}
KIND_NAMES = {value: key for key, value in EVENT_KINDS.items()}
EVENT_FIELDS = (
    "kind", "barDelta", "beat", "position", "part", "programFamily",
    "pitch", "duration2", "duration1", "duration0", "velocity",
    "tempo2", "tempo1", "tempo0", "meterNumerator",
    "meterDenominatorPower", "keySharps", "keyMinor", "controller",
    "controlValue", "bend1", "bend0", "pressure",
)
MAX_MARKERS = 1_000_000


def _blank(kind: str) -> dict[str, int]:
    event = {field: 0 for field in EVENT_FIELDS}
    event["kind"] = EVENT_KINDS[kind]
    return event


def _base_digits(value: int, base: int, count: int) -> tuple[int, ...]:
    if not 0 <= value < base ** count:
        raise ValueError(f"value {value} does not fit {count} base-{base} digits")
    digits = [0] * count
    for index in range(count - 1, -1, -1):
        digits[index] = value % base
        value //= base
    return tuple(digits)


def _from_digits(values: Sequence[int], base: int) -> int:
    result = 0
    for value in values:
        if not 0 <= value < base:
            raise ValueError(f"base-{base} digit out of range: {value}")
        result = result * base + value
    return result


def _denominator_power(denominator: int) -> int:
    if denominator < 1 or denominator > 128 \
            or denominator & (denominator - 1):
        raise ValueError(f"unsupported meter denominator {denominator}")
    return denominator.bit_length() - 1


def _meter_lengths(numerator: int, denominator_power: int) -> tuple[int, int]:
    if not 1 <= numerator <= 255 or not 0 <= denominator_power <= 7:
        raise ValueError("invalid compound meter")
    beat = 384 // (1 << denominator_power)
    return beat, numerator * beat


def _represented_payload(raw: dict[str, int], kind: str, q96: int,
                         part_ids: set[int]) -> dict[str, Any]:
    row: dict[str, Any] = {"kind": kind, "q96": q96}
    if kind == "METER":
        numerator = raw["meterNumerator"]
        denominator_power = raw["meterDenominatorPower"]
        _meter_lengths(numerator, denominator_power)
        row.update(numerator=numerator, denominator=1 << denominator_power)
    elif kind == "TEMPO":
        row["microsecondsPerQuarter"] = _from_digits(
            (raw["tempo2"], raw["tempo1"], raw["tempo0"]), 256)
    elif kind == "KEY":
        if not 0 <= raw["keySharps"] <= 14 \
                or raw["keyMinor"] not in (0, 1):
            raise ValueError("invalid compound key signature")
        row.update(sharps=raw["keySharps"] - 7,
                   minor=bool(raw["keyMinor"]))
    elif kind == "NOTE":
        if raw["part"] not in part_ids:
            raise ValueError(f"unknown compound part {raw['part']}")
        if not 0 <= raw["programFamily"] <= 16 \
                or not 0 <= raw["pitch"] <= 127 \
                or not 1 <= raw["velocity"] <= 127:
            raise ValueError("invalid compound note factor")
        row.update(
            part=raw["part"], programFamily=raw["programFamily"],
            pitch=raw["pitch"], velocity=raw["velocity"],
            duration96=_from_digits((raw["duration2"], raw["duration1"],
                                     raw["duration0"]), 128))
    elif kind in {"CONTROL", "BEND", "POLY_PRESSURE",
                  "CHANNEL_PRESSURE"}:
        if raw["part"] not in part_ids:
            raise ValueError(f"unknown compound part {raw['part']}")
        row["part"] = raw["part"]
        if kind == "CONTROL":
            if not 0 <= raw["controller"] <= 127 \
                    or not 0 <= raw["controlValue"] <= 127:
                raise ValueError("invalid compound controller")
            row.update(controller=raw["controller"], value=raw["controlValue"])
        elif kind == "BEND":
            row["value"] = _from_digits(
                (raw["bend1"], raw["bend0"]), 128) - 8192
        elif kind == "POLY_PRESSURE":
            if not 0 <= raw["pitch"] <= 127 \
                    or not 0 <= raw["pressure"] <= 127:
                raise ValueError("invalid compound poly pressure")
            row.update(pitch=raw["pitch"], value=raw["pressure"])
        else:
            if not 0 <= raw["pressure"] <= 127:
                raise ValueError("invalid compound channel pressure")
            row["value"] = raw["pressure"]
    return row


def _effective_meters(score: dict[str, Any], time_map: ScoreTimeMap
                      ) -> list[tuple[int, int, int]]:
    at_time: dict[int, tuple[int, int]] = {}
    for row in sorted(score["timeSignatures"], key=lambda item: (
            item["tick"], item["track"], item.get("order", 0))):
        numerator = row["numerator"]
        denominator_power = _denominator_power(row["denominator"])
        _meter_lengths(numerator, denominator_power)
        at_time[time_map.q96(row["tick"])] = (numerator, denominator_power)
    result = [(0, 4, 2)]
    for q96, meter in sorted(at_time.items()):
        if q96 == 0:
            result[0] = (0, *meter)
        else:
            result.append((q96, *meter))
    return result


def _source_timeline(score: dict[str, Any], time_map: ScoreTimeMap,
                     part_index: dict[tuple[int, int, int], int]
                     ) -> tuple[list[tuple[int, int, int, dict[str, int]]],
                                list[dict[str, float]]]:
    timeline: list[tuple[int, int, int, dict[str, int]]] = []
    note_errors: list[dict[str, float]] = []
    for row in score["timeSignatures"]:
        event = _blank("METER")
        event["meterNumerator"] = row["numerator"]
        event["meterDenominatorPower"] = _denominator_power(row["denominator"])
        timeline.append((time_map.q96(row["tick"]), 10,
                         row.get("order", 0), event))
    for row in score["tempos"]:
        event = _blank("TEMPO")
        event["tempo2"], event["tempo1"], event["tempo0"] = _base_digits(
            row["microsecondsPerQuarter"], 256, 3)
        timeline.append((time_map.q96(row["tick"]), 40,
                         row.get("order", 0), event))
    for row in score["keySignatures"]:
        if not -7 <= row["sharps"] <= 7:
            raise ValueError(f"invalid key signature {row['sharps']}")
        event = _blank("KEY")
        event["keySharps"] = row["sharps"] + 7
        event["keyMinor"] = int(row["minor"])
        timeline.append((time_map.q96(row["tick"]), 50,
                         row.get("order", 0), event))
    for order, row in enumerate(score["notes"]):
        start_q = time_map.q96(row["start"])
        end_q = time_map.q96(row["end"])
        duration = max(0, end_q - start_q)
        event = _blank("NOTE")
        event["part"] = part_index[(
            row["track"], row.get("port", 0), row["channel"])] + 1
        event["programFamily"] = 16 if row["drum"] else row["program"] // 8
        event["pitch"] = row["pitch"]
        event["duration2"], event["duration1"], event["duration0"] = \
            _base_digits(duration, 128, 3)
        event["velocity"] = row["velocity"]
        timeline.append((start_q, 60, order, event))

        original_start = time_map.microseconds(row["start"])
        original_end = time_map.microseconds(row["end"])
        decoded_start = time_map.microseconds_at_q96(start_q)
        decoded_end = time_map.microseconds_at_q96(start_q + duration)
        note_errors.append({
            "onsetMs": float(abs(decoded_start - original_start) / 1000),
            "durationMs": float(abs(
                (decoded_end - decoded_start)
                - (original_end - original_start)) / 1000),
        })
    for order, row in enumerate(score["controls"]):
        event = _blank("CONTROL")
        event["part"] = part_index[(
            row["track"], row.get("port", 0), row["channel"])] + 1
        event["controller"] = row["controller"]
        event["controlValue"] = row["value"]
        timeline.append((time_map.q96(row["tick"]), 70, order, event))
    for order, row in enumerate(score["pitchBends"]):
        event = _blank("BEND")
        event["part"] = part_index[(
            row["track"], row.get("port", 0), row["channel"])] + 1
        event["bend1"], event["bend0"] = _base_digits(
            row["value"] + 8192, 128, 2)
        timeline.append((time_map.q96(row["tick"]), 71, order, event))
    for order, row in enumerate(score["polyPressure"]):
        event = _blank("POLY_PRESSURE")
        event["part"] = part_index[(
            row["track"], row.get("port", 0), row["channel"])] + 1
        event["pitch"] = row["pitch"]
        event["pressure"] = row["value"]
        timeline.append((time_map.q96(row["tick"]), 72, order, event))
    for order, row in enumerate(score["channelPressure"]):
        event = _blank("CHANNEL_PRESSURE")
        event["part"] = part_index[(
            row["track"], row.get("port", 0), row["channel"])] + 1
        event["pressure"] = row["value"]
        timeline.append((time_map.q96(row["tick"]), 73, order, event))
    return timeline, note_errors


def _metric_markers(meters: Sequence[tuple[int, int, int]], max_q96: int
                    ) -> list[tuple[int, int, int, dict[str, int]]]:
    markers: list[tuple[int, int, int, dict[str, int]]] = []
    for index, (start, numerator, denominator_power) in enumerate(meters):
        end = meters[index + 1][0] if index + 1 < len(meters) else max_q96 + 1
        beat_length, bar_length = _meter_lengths(numerator, denominator_power)
        bar = start
        while bar < end and bar <= max_q96:
            markers.append((bar, 20, 0, _blank("BAR")))
            for beat in range(numerator):
                tick = bar + beat * beat_length
                if tick >= end or tick > max_q96:
                    break
                marker = _blank("BEAT")
                marker["beat"] = beat
                markers.append((tick, 30, beat, marker))
                if len(markers) > MAX_MARKERS:
                    raise ValueError("score exceeds metric marker safety limit")
            bar += bar_length
    return markers


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return round(ordered[index], 6)


def encode_score(score: dict[str, Any]) -> dict[str, Any]:
    if score.get("issues"):
        pairing = {key: value for key, value in score["issues"].items()
                   if key in {"orphanNoteOffs", "unterminatedNotes",
                              "unterminatedSustain"} and value}
        if pairing:
            raise ValueError(f"score has unresolved note pairing: {pairing}")
    time_map = ScoreTimeMap(score)
    channel_rows = [
        *score["notes"], *score["controls"], *score["pitchBends"],
        *score["polyPressure"], *score["channelPressure"],
    ]
    parts = sorted({(row["track"], row.get("port", 0), row["channel"])
                    for row in channel_rows})
    part_index = {part: index for index, part in enumerate(parts)}
    source, note_errors = _source_timeline(score, time_map, part_index)
    source_max = max((q96 for q96, _, _, _ in source), default=0)
    note_end_max = max((time_map.q96(row["end"]) for row in score["notes"]),
                       default=0)
    max_q96 = max(source_max, note_end_max)
    meters = _effective_meters(score, time_map)
    timeline = source + _metric_markers(meters, max_q96)
    timeline.extend([
        (0, 0, 0, _blank("BOS")),
        (max_q96, 100, 0, _blank("EOS")),
    ])
    timeline.sort(key=lambda item: (item[0], item[1], item[2],
                                    item[3]["kind"]))

    numerator, denominator_power = 4, 2
    bar_start = 0
    events: list[dict[str, int]] = []
    last_q = 0
    for q96, _, _, event in timeline:
        beat_length, bar_length = _meter_lengths(
            numerator, denominator_power)
        delta = q96 - bar_start
        if delta < 0:
            raise ValueError("metric timeline moved before current bar")
        bar_delta, remainder = divmod(delta, bar_length)
        beat, position = divmod(remainder, beat_length)
        if bar_delta > 1:
            raise ValueError("missing BAR markers in compound timeline")
        event["barDelta"] = bar_delta
        event["beat"] = beat
        event["position"] = position
        if q96 < last_q:
            raise ValueError("compound timeline is not monotonic")
        last_q = q96
        events.append(event)
        kind = KIND_NAMES[event["kind"]]
        if kind == "METER":
            numerator = event["meterNumerator"]
            denominator_power = event["meterDenominatorPower"]
            _meter_lengths(numerator, denominator_power)
            bar_start = q96
        elif kind == "BAR":
            bar_start = q96

    onset_errors = [row["onsetMs"] for row in note_errors]
    duration_errors = [row["durationMs"] for row in note_errors]
    timing_threshold_counts = {
        "notes": len(note_errors),
        "onsetAtMost5Ms": sum(value <= 5 for value in onset_errors),
        "onsetAtMost20Ms": sum(value <= 20 for value in onset_errors),
        "durationAtMost10Ms": sum(value <= 10 for value in duration_errors),
        "durationAtMost40Ms": sum(value <= 40 for value in duration_errors),
    }
    counts = collections.Counter(KIND_NAMES[row["kind"]] for row in events)
    result = {
        "schema": COMPOUND_SCHEMA,
        "sourceCanonicalScoreSha256": score["canonicalScoreSha256"],
        "division": score["division"],
        "resolution": 96,
        "partTable": [
            {"part": index + 1, "track": track, "port": port,
             "channel": channel}
            for index, (track, port, channel) in enumerate(parts)
        ],
        "events": events,
        "statistics": {
            "events": len(events),
            "eventKinds": dict(sorted(counts.items())),
            "duration96": max_q96,
            "onsetErrorMsMedian": round(median(onset_errors), 6)
            if onset_errors else None,
            "onsetErrorMsP99": _percentile(onset_errors, 0.99),
            "durationErrorMsMedian": round(median(duration_errors), 6)
            if duration_errors else None,
            "durationErrorMsP99": _percentile(duration_errors, 0.99),
            "timingThresholdCounts": timing_threshold_counts,
        },
        "unrepresentedStreams": {
            "programChangesReducedToNoteProgramFamily":
                len(score["programChanges"]),
            "sysex": len(score["sysex"]),
        },
    }
    # Decode immediately and compare every represented field before returning.
    part_ids = {row["part"] for row in result["partTable"]}
    expected = [_represented_payload(event, KIND_NAMES[event["kind"]], q96,
                                     part_ids)
                for q96, _, _, event in sorted(source, key=lambda item: (
                    item[0], item[1], item[2], item[3]["kind"]))]
    actual = represented_events(result)
    if expected != actual:
        mismatch = next((index for index, pair in enumerate(zip(expected, actual))
                         if pair[0] != pair[1]), min(len(expected), len(actual)))
        raise ValueError(
            f"compound represented-field mismatch at {mismatch}: "
            f"expected={len(expected)} actual={len(actual)}")
    result["statistics"]["representedRoundtrip"] = len(actual)
    return result


def decode_events(compound: dict[str, Any]) -> list[dict[str, Any]]:
    if compound.get("schema") != COMPOUND_SCHEMA:
        raise ValueError(f"not {COMPOUND_SCHEMA}")
    events = compound["events"]
    if not events or events[0]["kind"] != EVENT_KINDS["BOS"] \
            or events[-1]["kind"] != EVENT_KINDS["EOS"]:
        raise ValueError("compound sequence must begin with BOS and end with EOS")
    numerator, denominator_power = 4, 2
    bar_start = 0
    last_q = 0
    decoded = []
    part_ids = {row["part"] for row in compound["partTable"]}
    for raw in events:
        if set(raw) != set(EVENT_FIELDS):
            raise ValueError("compound event fields do not match schema")
        if raw["kind"] not in KIND_NAMES:
            raise ValueError(f"unknown event kind {raw['kind']}")
        if raw["barDelta"] not in (0, 1):
            raise ValueError("barDelta must be zero or one")
        beat_length, bar_length = _meter_lengths(
            numerator, denominator_power)
        if not 0 <= raw["beat"] < numerator \
                or not 0 <= raw["position"] < beat_length:
            raise ValueError("event metric position is outside the current bar")
        q96 = (bar_start + raw["barDelta"] * bar_length
               + raw["beat"] * beat_length + raw["position"])
        if q96 < last_q:
            raise ValueError("decoded compound time moved backwards")
        last_q = q96
        kind = KIND_NAMES[raw["kind"]]
        row = _represented_payload(raw, kind, q96, part_ids)
        if kind == "METER":
            numerator = raw["meterNumerator"]
            denominator_power = raw["meterDenominatorPower"]
            bar_start = q96
        elif kind == "BAR":
            bar_start = q96
        decoded.append(row)
    return decoded


def represented_events(compound: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in decode_events(compound)
            if row["kind"] in {"METER", "TEMPO", "KEY", "NOTE", "CONTROL",
                               "BEND", "POLY_PRESSURE", "CHANNEL_PRESSURE"}]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    compound = encode_score(read_score(args.input))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(
        compound, separators=(",", ":"), sort_keys=True) + "\n")
    print(json.dumps({
        "schema": compound["schema"],
        "sourceCanonicalScoreSha256": compound["sourceCanonicalScoreSha256"],
        "statistics": compound["statistics"],
        "unrepresentedStreams": compound["unrepresentedStreams"],
        "output": str(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
