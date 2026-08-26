from __future__ import annotations

import hashlib
import json
import math
import wave
from collections import Counter
from pathlib import Path

import numpy as np


SAMPLE_RATE = 44_100
FINE_STEPS_PER_BAR = 128
COARSE_STEPS_PER_BAR = 32
UNWRITTEN_U8 = 0xFF
UNWRITTEN_U16 = 0xFFFF
GAMEBOY_REGISTER_COUNT = 0x30
GAMEBOY_KNOWN_MASK_BYTES = GAMEBOY_REGISTER_COUNT // 8
MAXIMUM_PHRASE_BARS = 16
CHANNEL_NAMES = ("pulse1", "pulse2", "wave", "noise")
MODE_NAMES = (
    "ionian",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
    "aeolian",
    "locrian",
)
MODE_INTERVALS = (
    (0, 2, 4, 5, 7, 9, 11),
    (0, 2, 3, 5, 7, 9, 10),
    (0, 1, 3, 5, 7, 8, 10),
    (0, 2, 4, 6, 7, 9, 11),
    (0, 2, 4, 5, 7, 9, 10),
    (0, 2, 3, 5, 7, 8, 10),
    (0, 1, 3, 5, 6, 8, 10),
)


COMPOSITION_EVENT_DTYPE = np.dtype(
    [
        ("sample", "<i8"),
        ("deltaSamples", "<i8"),
        ("secondsMicros", "<i8"),
        ("channel", "u1"),
        ("pitchCents", "<i4"),
        ("velocityQ15", "<u2"),
        ("intervalCents", "<i4"),
        ("hasPreviousPitch", "u1"),
        ("sincePreviousChannelSamples", "<i8"),
        ("untilNextTriggerSamples", "<i8"),
        ("region", "u1"),
        ("sectionRelativeSample", "<i8"),
        ("qualifiedTiming", "u1"),
        ("fineGrid", "<i4"),
        ("coarseGrid", "<i4"),
        ("residualSamples", "<i4"),
        ("onsetGroup", "<i4"),
        ("simultaneousOnsetCount", "<u2"),
        ("channelEventIndex", "<i4"),
        ("phraseIndex", "<i4"),
        ("phraseRelativeFine", "<i4"),
    ]
)


PERFORMANCE_EVENT_DTYPE = np.dtype(
    [
        ("channel", "u1"),
        ("sourceRegisterOrder", "<i8"),
        ("frequencyLow", "<u2"),
        ("frequencyHigh", "u1"),
        ("frequencyRegister", "<u2"),
        ("lengthLoad", "<u2"),
        ("lengthEnabled", "u1"),
        ("duty", "u1"),
        ("initialVolume", "u1"),
        ("envelopeDirection", "u1"),
        ("envelopeRate", "u1"),
        ("sweepPeriod", "u1"),
        ("sweepDirection", "u1"),
        ("sweepShift", "u1"),
        ("waveDacEnabled", "u1"),
        ("waveOutputLevel", "u1"),
        ("waveTable", "u1", (32,)),
        ("noiseDivisor", "u1"),
        ("noiseWidthMode", "u1"),
        ("noiseClockShift", "u1"),
        ("masterLeftVolume", "u1"),
        ("masterRightVolume", "u1"),
        ("vinLeft", "u1"),
        ("vinRight", "u1"),
        ("routing", "<u2"),
        ("masterEnabled", "u1"),
    ]
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _close_memmap(array) -> None:
    memory_map = getattr(array, "_mmap", None)
    if memory_map is not None:
        memory_map.close()


def _read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def _write_json(path: Path, value) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    )


def _register_known(states: np.ndarray, address: int) -> np.ndarray:
    mask_column = GAMEBOY_REGISTER_COUNT + address // 8
    return ((states[:, mask_column] >> (address % 8)) & 1).astype(bool)


def _set_known_value(
    destination: np.ndarray,
    field: str,
    states: np.ndarray,
    address: int,
    transform,
    selection: np.ndarray | None = None,
) -> None:
    known = _register_known(states, address)
    if selection is not None:
        known &= selection
    destination[field][known] = transform(states[known, address])


def decode_performance_events(
    exact_events: np.ndarray,
    trigger_states: np.ndarray,
) -> np.ndarray:
    """Decode channel-specific raw APU categories without learned patch IDs."""

    events = np.asarray(exact_events, dtype=np.int64)
    states = np.asarray(trigger_states, dtype=np.uint8)
    if len(events) != len(states):
        raise ValueError("performance decode requires aligned events and states")
    if states.ndim != 2 or states.shape[1] != (
        GAMEBOY_REGISTER_COUNT + GAMEBOY_KNOWN_MASK_BYTES
    ):
        raise ValueError("unexpected Game Boy trigger-state shape")
    output = np.empty(len(events), dtype=PERFORMANCE_EVENT_DTYPE)
    for field in output.dtype.names:
        if field == "sourceRegisterOrder":
            output[field] = events[:, 7]
        elif field in (
            "frequencyLow",
            "frequencyRegister",
            "lengthLoad",
            "routing",
        ):
            output[field] = UNWRITTEN_U16
        elif field == "waveTable":
            output[field].fill(UNWRITTEN_U8)
        else:
            output[field].fill(UNWRITTEN_U8)
    output["channel"] = events[:, 1].astype(np.uint8)

    channels = events[:, 1]
    pulse1 = channels == 0
    pulse2 = channels == 1
    wave_channel = channels == 2
    noise = channels == 3

    _set_known_value(
        output,
        "sweepPeriod",
        states,
        0x00,
        lambda values: (values >> 4) & 7,
        pulse1,
    )
    _set_known_value(
        output,
        "sweepDirection",
        states,
        0x00,
        lambda values: (values >> 3) & 1,
        pulse1,
    )
    _set_known_value(
        output,
        "sweepShift",
        states,
        0x00,
        lambda values: values & 7,
        pulse1,
    )

    for channel_mask, duty_address, envelope_address, low_address, high_address in (
        (pulse1, 0x01, 0x02, 0x03, 0x04),
        (pulse2, 0x06, 0x07, 0x08, 0x09),
    ):
        _set_known_value(
            output,
            "duty",
            states,
            duty_address,
            lambda values: (values >> 6) & 3,
            channel_mask,
        )
        _set_known_value(
            output,
            "lengthLoad",
            states,
            duty_address,
            lambda values: values & 0x3F,
            channel_mask,
        )
        _set_known_value(
            output,
            "initialVolume",
            states,
            envelope_address,
            lambda values: (values >> 4) & 0x0F,
            channel_mask,
        )
        _set_known_value(
            output,
            "envelopeDirection",
            states,
            envelope_address,
            lambda values: (values >> 3) & 1,
            channel_mask,
        )
        _set_known_value(
            output,
            "envelopeRate",
            states,
            envelope_address,
            lambda values: values & 7,
            channel_mask,
        )
        _set_known_value(
            output,
            "frequencyLow",
            states,
            low_address,
            lambda values: values,
            channel_mask,
        )
        _set_known_value(
            output,
            "frequencyHigh",
            states,
            high_address,
            lambda values: values & 7,
            channel_mask,
        )
        _set_known_value(
            output,
            "lengthEnabled",
            states,
            high_address,
            lambda values: (values >> 6) & 1,
            channel_mask,
        )

    _set_known_value(
        output,
        "waveDacEnabled",
        states,
        0x0A,
        lambda values: (values >> 7) & 1,
        wave_channel,
    )
    _set_known_value(
        output,
        "lengthLoad",
        states,
        0x0B,
        lambda values: values,
        wave_channel,
    )
    _set_known_value(
        output,
        "waveOutputLevel",
        states,
        0x0C,
        lambda values: (values >> 5) & 3,
        wave_channel,
    )
    _set_known_value(
        output,
        "frequencyLow",
        states,
        0x0D,
        lambda values: values,
        wave_channel,
    )
    _set_known_value(
        output,
        "frequencyHigh",
        states,
        0x0E,
        lambda values: values & 7,
        wave_channel,
    )
    _set_known_value(
        output,
        "lengthEnabled",
        states,
        0x0E,
        lambda values: (values >> 6) & 1,
        wave_channel,
    )
    for byte_index, address in enumerate(range(0x20, 0x30)):
        known = _register_known(states, address) & wave_channel
        output["waveTable"][known, byte_index * 2] = (
            states[known, address] >> 4
        )
        output["waveTable"][known, byte_index * 2 + 1] = (
            states[known, address] & 0x0F
        )

    _set_known_value(
        output,
        "lengthLoad",
        states,
        0x10,
        lambda values: values & 0x3F,
        noise,
    )
    _set_known_value(
        output,
        "initialVolume",
        states,
        0x11,
        lambda values: (values >> 4) & 0x0F,
        noise,
    )
    _set_known_value(
        output,
        "envelopeDirection",
        states,
        0x11,
        lambda values: (values >> 3) & 1,
        noise,
    )
    _set_known_value(
        output,
        "envelopeRate",
        states,
        0x11,
        lambda values: values & 7,
        noise,
    )
    _set_known_value(
        output,
        "noiseClockShift",
        states,
        0x12,
        lambda values: (values >> 4) & 0x0F,
        noise,
    )
    _set_known_value(
        output,
        "noiseWidthMode",
        states,
        0x12,
        lambda values: (values >> 3) & 1,
        noise,
    )
    _set_known_value(
        output,
        "noiseDivisor",
        states,
        0x12,
        lambda values: values & 7,
        noise,
    )
    _set_known_value(
        output,
        "lengthEnabled",
        states,
        0x13,
        lambda values: (values >> 6) & 1,
        noise,
    )

    _set_known_value(
        output,
        "masterRightVolume",
        states,
        0x14,
        lambda values: values & 7,
    )
    _set_known_value(
        output,
        "vinRight",
        states,
        0x14,
        lambda values: (values >> 3) & 1,
    )
    _set_known_value(
        output,
        "masterLeftVolume",
        states,
        0x14,
        lambda values: (values >> 4) & 7,
    )
    _set_known_value(
        output,
        "vinLeft",
        states,
        0x14,
        lambda values: (values >> 7) & 1,
    )
    _set_known_value(
        output,
        "routing",
        states,
        0x15,
        lambda values: values,
    )
    _set_known_value(
        output,
        "masterEnabled",
        states,
        0x16,
        lambda values: (values >> 7) & 1,
    )

    frequency_known = (
        (output["frequencyLow"] != UNWRITTEN_U16)
        & (output["frequencyHigh"] != UNWRITTEN_U8)
    )
    output["frequencyRegister"][frequency_known] = (
        output["frequencyLow"][frequency_known].astype(np.uint16)
        | (
            output["frequencyHigh"][frequency_known].astype(np.uint16)
            << 8
        )
    )
    return output


def _count_register_mismatch(
    states: np.ndarray,
    selection: np.ndarray,
    address: int,
    encoded: np.ndarray,
    bit_mask: int = 0xFF,
) -> tuple[int, int]:
    compared = selection & _register_known(states, address)
    mismatches = np.count_nonzero(
        ((states[:, address] ^ encoded) & bit_mask)[compared]
    )
    return int(mismatches), int(np.count_nonzero(compared))


def performance_roundtrip_audit(
    exact_events: np.ndarray,
    trigger_states: np.ndarray,
    performance: np.ndarray,
) -> dict:
    """Re-encode every decoded categorical field and compare raw APU bits."""

    events = np.asarray(exact_events, dtype=np.int64)
    states = np.asarray(trigger_states, dtype=np.uint8)
    rows = np.asarray(performance)
    channels = events[:, 1]
    mismatches = 0
    compared = 0

    def compare(selection, address, encoded, bit_mask=0xFF):
        nonlocal mismatches, compared
        bad, count = _count_register_mismatch(
            states,
            selection,
            address,
            encoded.astype(np.uint8),
            bit_mask,
        )
        mismatches += bad
        compared += count

    pulse1 = channels == 0
    pulse2 = channels == 1
    wave_channel = channels == 2
    noise = channels == 3

    compare(
        pulse1,
        0x00,
        (rows["sweepPeriod"] << 4)
        | (rows["sweepDirection"] << 3)
        | rows["sweepShift"],
        0x7F,
    )
    for selection, duty_address, envelope_address, low_address, high_address in (
        (pulse1, 0x01, 0x02, 0x03, 0x04),
        (pulse2, 0x06, 0x07, 0x08, 0x09),
    ):
        compare(
            selection,
            duty_address,
            (rows["duty"] << 6) | rows["lengthLoad"],
        )
        compare(
            selection,
            envelope_address,
            (rows["initialVolume"] << 4)
            | (rows["envelopeDirection"] << 3)
            | rows["envelopeRate"],
        )
        compare(selection, low_address, rows["frequencyLow"])
        compare(
            selection,
            high_address,
            rows["frequencyHigh"]
            | (rows["lengthEnabled"] << 6)
            | 0x80,
            0xC7,
        )

    compare(
        wave_channel,
        0x0A,
        rows["waveDacEnabled"] << 7,
        0x80,
    )
    compare(wave_channel, 0x0B, rows["lengthLoad"])
    compare(
        wave_channel,
        0x0C,
        rows["waveOutputLevel"] << 5,
        0x60,
    )
    compare(wave_channel, 0x0D, rows["frequencyLow"])
    compare(
        wave_channel,
        0x0E,
        rows["frequencyHigh"]
        | (rows["lengthEnabled"] << 6)
        | 0x80,
        0xC7,
    )
    for byte_index, address in enumerate(range(0x20, 0x30)):
        encoded = (
            rows["waveTable"][:, byte_index * 2] << 4
        ) | rows["waveTable"][:, byte_index * 2 + 1]
        compare(wave_channel, address, encoded)

    compare(noise, 0x10, rows["lengthLoad"], 0x3F)
    compare(
        noise,
        0x11,
        (rows["initialVolume"] << 4)
        | (rows["envelopeDirection"] << 3)
        | rows["envelopeRate"],
    )
    compare(
        noise,
        0x12,
        (rows["noiseClockShift"] << 4)
        | (rows["noiseWidthMode"] << 3)
        | rows["noiseDivisor"],
    )
    compare(
        noise,
        0x13,
        (rows["lengthEnabled"] << 6) | 0x80,
        0xC0,
    )

    compare(
        np.ones(len(rows), dtype=bool),
        0x14,
        (rows["vinLeft"] << 7)
        | (rows["masterLeftVolume"] << 4)
        | (rows["vinRight"] << 3)
        | rows["masterRightVolume"],
    )
    compare(
        np.ones(len(rows), dtype=bool),
        0x15,
        rows["routing"],
    )
    compare(
        np.ones(len(rows), dtype=bool),
        0x16,
        rows["masterEnabled"] << 7,
        0x80,
    )

    pitch_errors = 0
    pitch_compared = 0
    frequency_known = rows["frequencyRegister"] != UNWRITTEN_U16
    for channel, numerator in ((0, 131_072), (1, 131_072), (2, 65_536)):
        selected = (channels == channel) & frequency_known
        if not np.any(selected):
            continue
        frequency = numerator / np.maximum(
            1,
            2_048 - rows["frequencyRegister"][selected].astype(np.float64),
        )
        pitch_cents = np.rint(
            (69 + 12 * np.log2(frequency / 440)) * 100
        ).astype(np.int64)
        pitch_errors += int(
            np.count_nonzero(pitch_cents != events[selected, 2])
        )
        pitch_compared += int(np.count_nonzero(selected))
    pitch_errors += int(
        np.count_nonzero(events[channels == 3, 2] != -1)
    )
    pitch_compared += int(np.count_nonzero(channels == 3))
    return {
        "categoricalRegistersCompared": compared,
        "categoricalRoundtripErrors": mismatches,
        "pitchValuesCompared": pitch_compared,
        "pitchRoundtripErrors": pitch_errors,
    }


def _until_next_trigger(
    events: np.ndarray,
    track_end_sample: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    since_previous = np.zeros(len(events), dtype=np.int64)
    until_next = np.zeros(len(events), dtype=np.int64)
    channel_indices = np.zeros(len(events), dtype=np.int32)
    for channel in range(4):
        indices = np.flatnonzero(events[:, 1] == channel)
        if not len(indices):
            continue
        samples = events[indices, 0].astype(np.int64)
        previous = np.insert(samples[:-1], 0, 0)
        following = np.append(samples[1:], max(track_end_sample, samples[-1]))
        since_previous[indices] = np.maximum(0, samples - previous)
        until_next[indices] = np.maximum(0, following - samples)
        channel_indices[indices] = np.arange(len(indices), dtype=np.int32)
    return since_previous, until_next, channel_indices


def _intervals(events: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    intervals = np.zeros(len(events), dtype=np.int32)
    previous = np.zeros(len(events), dtype=np.uint8)
    for channel in range(3):
        indices = np.flatnonzero(events[:, 1] == channel)
        if len(indices) > 1:
            intervals[indices[1:]] = np.diff(events[indices, 2]).astype(
                np.int32
            )
            previous[indices[1:]] = 1
    return intervals, previous


def _key_descriptor(pitch_cents: np.ndarray) -> dict:
    pitches = np.asarray(pitch_cents, dtype=np.int64)
    pitches = pitches[pitches >= 0]
    if not len(pitches):
        return {
            "tonicPitchClass": None,
            "mode": None,
            "modeIndex": None,
            "confidence": 0.0,
            "scaleCoverage": 0.0,
            "qualifiedTop": False,
            "pitchClasses": 0,
            "pitchClassEntropy": 0.0,
            "pitchClassHistogramQ15": [0] * 12,
            "hypotheses": [],
        }
    pitch_classes = np.mod(np.rint(pitches / 100).astype(np.int64), 12)
    histogram = np.bincount(pitch_classes, minlength=12).astype(np.float64)
    histogram /= histogram.sum()
    candidates = []
    for tonic in range(12):
        for mode_index, intervals in enumerate(MODE_INTERVALS):
            scale = {(tonic + interval) % 12 for interval in intervals}
            coverage = float(sum(histogram[pitch] for pitch in scale))
            tonic_weight = float(histogram[tonic])
            fifth_weight = float(histogram[(tonic + 7) % 12])
            third_weight = float(
                max(
                    histogram[(tonic + 3) % 12],
                    histogram[(tonic + 4) % 12],
                )
            )
            score = (
                coverage
                + 0.22 * tonic_weight
                + 0.10 * fifth_weight
                + 0.06 * third_weight
            )
            candidates.append(
                (score, coverage, tonic, mode_index)
            )
    candidates.sort(reverse=True)
    best, second = candidates[0], candidates[1]
    confidence = max(
        0.0,
        min(1.0, (best[0] - second[0]) / max(1e-9, best[0])),
    )
    hypotheses = [
        {
            "tonicPitchClass": tonic,
            "mode": MODE_NAMES[mode_index],
            "modeIndex": mode_index,
            "score": round(float(score), 9),
            "relativeScore": round(float(score / max(1e-9, best[0])), 9),
            "scaleCoverage": round(float(coverage), 9),
        }
        for score, coverage, tonic, mode_index in candidates[:6]
    ]
    distinct_pitch_classes = int(np.count_nonzero(histogram))
    return {
        "tonicPitchClass": best[2],
        "mode": MODE_NAMES[best[3]],
        "modeIndex": best[3],
        "confidence": round(confidence, 9),
        "scaleCoverage": round(best[1], 9),
        "qualifiedTop": bool(
            len(pitches) >= 12
            and distinct_pitch_classes >= 5
            and best[1] >= 0.80
            and confidence >= 0.02
        ),
        "pitchClasses": distinct_pitch_classes,
        "pitchClassEntropy": round(_entropy(pitch_classes), 9),
        "pitchClassHistogramQ15": np.rint(histogram * 32_767)
        .astype(np.int64)
        .tolist(),
        "hypotheses": hypotheses,
    }


def _cosine_distance(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 1e-12:
        return 0.0 if not np.any(left) and not np.any(right) else 1.0
    return float(1 - np.dot(left, right) / denominator)


def _bar_features(
    events: np.ndarray,
    fine_grid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, int]:
    bar_numbers = np.floor_divide(fine_grid, FINE_STEPS_PER_BAR)
    first_bar = int(bar_numbers.min())
    normalized_bars = bar_numbers - first_bar
    bar_count = int(normalized_bars.max()) + 1
    rhythm = np.zeros((bar_count, 4, COARSE_STEPS_PER_BAR), dtype=np.float32)
    pitch_class = np.zeros((bar_count, 12), dtype=np.float32)
    density = np.zeros((bar_count, 4), dtype=np.float32)
    for index, bar in enumerate(normalized_bars):
        channel = int(events[index, 1])
        slot = int((fine_grid[index] % FINE_STEPS_PER_BAR) // 4)
        rhythm[bar, channel, slot] = 1
        density[bar, channel] += 1
        if channel < 3 and events[index, 2] >= 0:
            pitch = round(int(events[index, 2]) / 100) % 12
            pitch_class[bar, pitch] += 1
    rhythm_flat = rhythm.reshape(bar_count, -1)
    pitch_totals = pitch_class.sum(axis=1, keepdims=True)
    pitch_class = np.divide(
        pitch_class,
        np.maximum(1, pitch_totals),
    )
    density = np.log1p(density)
    density /= np.maximum(1, density.max(axis=0, keepdims=True))
    features = np.concatenate(
        (rhythm_flat, pitch_class * 1.5, density),
        axis=1,
    )
    return features, normalized_bars.astype(np.int32), first_bar


def _phrase_boundaries(
    features: np.ndarray,
    normalized_bars: np.ndarray,
    regions: np.ndarray,
) -> tuple[list[int], dict[int, float], set[int]]:
    bar_count = len(features)
    if bar_count <= 1:
        return [0, bar_count], {}, {0}
    novelty = np.zeros(bar_count, dtype=np.float64)
    for boundary in range(1, bar_count):
        novelty[boundary] = _cosine_distance(
            features[boundary - 1],
            features[boundary],
        )
    positive = novelty[1:]
    median = float(np.median(positive))
    mad = float(np.median(np.abs(positive - median)))
    phrase_threshold = max(
        float(np.percentile(positive, 65)),
        median + 0.5 * mad,
    )
    section_threshold = max(
        float(np.percentile(positive, 85)),
        median + 1.5 * mad,
    )
    candidates = {
        boundary
        for boundary in range(1, bar_count)
        if novelty[boundary] >= phrase_threshold
        and novelty[boundary] >= novelty[max(1, boundary - 1)]
        and novelty[boundary] >= novelty[min(bar_count - 1, boundary + 1)]
    }
    region_boundaries = set()
    for boundary in range(1, bar_count):
        previous = regions[normalized_bars == boundary - 1]
        following = regions[normalized_bars == boundary]
        if len(previous) and len(following) and previous[-1] != following[0]:
            candidates.add(boundary)
            region_boundaries.add(boundary)

    boundaries = {0, bar_count, *candidates}
    while True:
        ordered = sorted(boundaries)
        oversized = next(
            (
                (left, right)
                for left, right in zip(ordered, ordered[1:])
                if right - left > MAXIMUM_PHRASE_BARS
            ),
            None,
        )
        if oversized is None:
            break
        left, right = oversized
        search_start = left + max(1, (right - left) // 4)
        search_end = right - max(1, (right - left) // 4)
        if search_start >= search_end:
            selected = (left + right) // 2
        else:
            selected = max(
                range(search_start, search_end + 1),
                key=lambda boundary: (novelty[boundary], -boundary),
            )
        boundaries.add(selected)
    ordered = sorted(boundaries)
    section_boundaries = {
        boundary
        for boundary in ordered
        if boundary == 0
        or boundary in region_boundaries
        or (
            boundary < bar_count
            and novelty[boundary] >= section_threshold
        )
    }
    return (
        ordered,
        {
            boundary: round(float(novelty[boundary]), 9)
            for boundary in ordered
            if 0 < boundary < bar_count
        },
        section_boundaries,
    )


def _entropy(values: np.ndarray) -> float:
    if not len(values):
        return 0.0
    counts = np.asarray(list(Counter(map(int, values)).values()), dtype=np.float64)
    probability = counts / counts.sum()
    return float(-(probability * np.log2(probability)).sum())


def _phrase_fingerprint(
    phrase_events: np.ndarray,
    phrase_composition: np.ndarray,
    start_fine: int,
    end_fine: int,
) -> str:
    """Hash transposition-neutral rhythm and per-lane contour exactly."""

    digest = hashlib.sha256()
    digest.update(int(end_fine - start_fine).to_bytes(8, "little", signed=True))
    previous_pitch = [None, None, None]
    for event, composition in zip(phrase_events, phrase_composition):
        channel = int(event[1])
        pitch = int(event[2])
        if channel < 3:
            prior = previous_pitch[channel]
            contour = 0 if prior is None else pitch - prior
            previous_pitch[channel] = pitch
        else:
            contour = 0
        digest.update(
            int(composition["fineGrid"] - start_fine).to_bytes(
                8,
                "little",
                signed=True,
            )
        )
        digest.update(channel.to_bytes(1, "little"))
        digest.update(int(contour).to_bytes(4, "little", signed=True))
    return digest.hexdigest()


def _bar_harmonic_distances(
    phrase_events: np.ndarray,
    phrase_composition: np.ndarray,
    start_fine: int,
    bars: int,
) -> list[float]:
    pitch_class = np.zeros((bars, 12), dtype=np.float64)
    for event, composition in zip(phrase_events, phrase_composition):
        if int(event[1]) >= 3 or int(event[2]) < 0:
            continue
        bar = min(
            bars - 1,
            max(
                0,
                int(composition["fineGrid"] - start_fine)
                // FINE_STEPS_PER_BAR,
            ),
        )
        pitch = round(int(event[2]) / 100) % 12
        pitch_class[bar, pitch] += 1
    totals = pitch_class.sum(axis=1, keepdims=True)
    pitch_class = np.divide(pitch_class, np.maximum(1, totals))
    return [
        round(_cosine_distance(left, right), 9)
        for left, right in zip(pitch_class, pitch_class[1:])
    ]


def _assign_phrase_motifs(phrases: list[dict]) -> None:
    motif_indices = {}
    motif_counts = Counter(phrase["motifFingerprint"] for phrase in phrases)
    motif_occurrences = Counter()
    section_occurrences = Counter()
    phrase_count = len(phrases)
    for phrase_index, phrase in enumerate(phrases):
        fingerprint = phrase["motifFingerprint"]
        if fingerprint not in motif_indices:
            motif_indices[fingerprint] = len(motif_indices)
        motif_index = motif_indices[fingerprint]
        occurrence = motif_occurrences[fingerprint]
        section_key = phrase["sectionIndex"]
        section_position = section_occurrences[section_key]
        motif_occurrences[fingerprint] += 1
        section_occurrences[section_key] += 1
        phrase["motifIndex"] = motif_index
        phrase["motifOccurrenceIndex"] = occurrence
        phrase["motifOccurrences"] = motif_counts[fingerprint]
        phrase["structuralRole"] = {
            "relativePosition": round(
                phrase_index / max(1, phrase_count - 1),
                9,
            ),
            "sectionPhraseIndex": section_position,
            "isOpening": phrase_index == 0,
            "isClosing": phrase_index == phrase_count - 1,
            "isMotifReturn": occurrence > 0,
        }


def factor_track_composition(
    track_index: int,
    track: dict,
    hygiene_track: dict,
    events: np.ndarray,
    timing_events: np.ndarray,
    timing_hypothesis: dict,
) -> tuple[np.ndarray, list[dict], dict]:
    output = np.empty(len(events), dtype=COMPOSITION_EVENT_DTYPE)
    output["sample"] = timing_events["sample"]
    output["deltaSamples"] = timing_events["deltaSamples"]
    output["secondsMicros"] = timing_events["secondsMicros"]
    output["channel"] = events[:, 1]
    output["pitchCents"] = events[:, 2]
    output["velocityQ15"] = events[:, 3]
    intervals, has_previous = _intervals(events)
    output["intervalCents"] = intervals
    output["hasPreviousPitch"] = has_previous
    track_end = max(
        int(track.get("commandSamples", 0)),
        int(events[-1, 0]) + 1,
    )
    since_previous, until_next, channel_event_index = _until_next_trigger(
        events,
        track_end,
    )
    output["sincePreviousChannelSamples"] = since_previous
    output["untilNextTriggerSamples"] = until_next
    output["region"] = timing_events["region"]
    output["sectionRelativeSample"] = timing_events["sectionRelativeSample"]
    qualified = bool(timing_hypothesis["qualifiedTop"])
    output["qualifiedTiming"] = int(qualified)
    output["fineGrid"] = timing_events["h0FineGrid"]
    output["coarseGrid"] = timing_events["h0CoarseGrid"]
    output["residualSamples"] = timing_events["h0ResidualSamples"]
    _, onset_group, onset_counts = np.unique(
        events[:, 0],
        return_inverse=True,
        return_counts=True,
    )
    output["onsetGroup"] = onset_group.astype(np.int32)
    output["simultaneousOnsetCount"] = onset_counts[onset_group].astype(
        np.uint16
    )
    output["channelEventIndex"] = channel_event_index
    output["phraseIndex"].fill(-1)
    output["phraseRelativeFine"].fill(0)

    phrase_rows = []
    section_count = 0
    phrase_bars = []
    if qualified:
        features, normalized_bars, first_bar = _bar_features(
            events,
            output["fineGrid"],
        )
        boundaries, novelty, section_boundaries = _phrase_boundaries(
            features,
            normalized_bars,
            output["region"],
        )
        phrase_assignment = np.searchsorted(
            np.asarray(boundaries[1:], dtype=np.int32),
            normalized_bars,
            side="right",
        ).astype(np.int32)
        phrase_assignment = np.minimum(
            phrase_assignment,
            len(boundaries) - 2,
        )
        current_section = -1
        for phrase_index, (start_bar, end_bar) in enumerate(
            zip(boundaries, boundaries[1:])
        ):
            if start_bar in section_boundaries:
                current_section += 1
            selected = phrase_assignment == phrase_index
            selected_indices = np.flatnonzero(selected)
            if not len(selected_indices):
                continue
            actual_phrase_index = len(phrase_rows)
            output["phraseIndex"][selected] = actual_phrase_index
            start_fine = (first_bar + start_bar) * FINE_STEPS_PER_BAR
            end_fine = (first_bar + end_bar) * FINE_STEPS_PER_BAR
            output["phraseRelativeFine"][selected] = (
                output["fineGrid"][selected] - start_fine
            )
            phrase_events = events[selected]
            phrase_composition = output[selected]
            channels = phrase_events[:, 1]
            bar_count = end_bar - start_bar
            harmonic_distances = _bar_harmonic_distances(
                phrase_events,
                phrase_composition,
                start_fine,
                bar_count,
            )
            channel_presence = [
                bool(np.any(channels == channel))
                for channel in range(4)
            ]
            channel_descriptors = []
            for channel in range(4):
                lane_mask = channels == channel
                lane = phrase_events[lane_mask]
                lane_composition = phrase_composition[lane_mask]
                pitches = lane[lane[:, 2] >= 0, 2]
                lane_intervals = (
                    np.diff(pitches) if len(pitches) > 1 else np.empty(0)
                )
                edge_count = max(1, math.ceil(len(pitches) / 4))
                register_start = (
                    float(np.median(pitches[:edge_count]))
                    if len(pitches)
                    else None
                )
                register_end = (
                    float(np.median(pitches[-edge_count:]))
                    if len(pitches)
                    else None
                )
                repeated = (
                    (
                        (lane_composition["hasPreviousPitch"] != 0)
                        & (lane_composition["intervalCents"] == 0)
                    )
                    if channel < 3
                    else np.zeros(len(lane), dtype=bool)
                )
                channel_descriptors.append(
                    {
                        "present": bool(len(lane)),
                        "onsets": int(len(lane)),
                        "onsetsPerBar": round(
                            len(lane) / max(1, bar_count),
                            9,
                        ),
                        "medianPitchCents": (
                            round(float(np.median(pitches)), 3)
                            if len(pitches)
                            else None
                        ),
                        "minimumPitchCents": (
                            int(pitches.min()) if len(pitches) else None
                        ),
                        "maximumPitchCents": (
                            int(pitches.max()) if len(pitches) else None
                        ),
                        "registerStartCents": (
                            round(register_start, 3)
                            if register_start is not None
                            else None
                        ),
                        "registerEndCents": (
                            round(register_end, 3)
                            if register_end is not None
                            else None
                        ),
                        "registerDeltaCents": (
                            round(register_end - register_start, 3)
                            if register_start is not None
                            and register_end is not None
                            else None
                        ),
                        "intervalEntropy": round(
                            _entropy(lane_intervals),
                            9,
                        ),
                        "samePitchRetriggerFraction": round(
                            float(np.mean(repeated)) if len(repeated) else 0.0,
                            9,
                        ),
                        "medianGapSamples": (
                            round(
                                float(
                                    np.median(
                                        lane_composition[
                                            "sincePreviousChannelSamples"
                                        ]
                                    )
                                ),
                                3,
                            )
                            if len(lane)
                            else None
                        ),
                        "medianUntilNextTriggerSamples": (
                            round(
                                float(
                                    np.median(
                                        lane_composition[
                                            "untilNextTriggerSamples"
                                        ]
                                    )
                                ),
                                3,
                            )
                            if len(lane)
                            else None
                        ),
                    }
                )
            phrase_key = _key_descriptor(
                phrase_events[phrase_events[:, 1] < 3, 2]
            )
            phrase_rows.append(
                {
                    "trackIndex": track_index,
                    "source": track["source"],
                    "split": hygiene_track["split"],
                    "phraseIndex": actual_phrase_index,
                    "sectionIndex": current_section,
                    "startBar": first_bar + start_bar,
                    "endBar": first_bar + end_bar,
                    "bars": end_bar - start_bar,
                    "startFine": start_fine,
                    "endFine": end_fine,
                    "startSample": int(events[selected_indices[0], 0]),
                    "endSample": int(
                        events[selected_indices[-1] + 1, 0]
                        if selected_indices[-1] + 1 < len(events)
                        else track_end
                    ),
                    "boundaryNovelty": novelty.get(start_bar, 0.0),
                    "events": int(len(phrase_events)),
                    "meanVelocityQ15": round(
                        float(np.mean(phrase_composition["velocityQ15"])),
                        3,
                    ),
                    "harmonicBarDistances": harmonic_distances,
                    "meanHarmonicBarDistance": round(
                        float(np.mean(harmonic_distances))
                        if harmonic_distances
                        else 0.0,
                        9,
                    ),
                    "maximumHarmonicBarDistance": round(
                        max(harmonic_distances, default=0.0),
                        9,
                    ),
                    "motifFingerprint": _phrase_fingerprint(
                        phrase_events,
                        phrase_composition,
                        start_fine,
                        end_fine,
                    ),
                    "region": int(
                        Counter(
                            map(int, output["region"][selected])
                        ).most_common(1)[0][0]
                    ),
                    "channelPresence": channel_presence,
                    "channelPresenceMask": sum(
                        int(present) << channel
                        for channel, present in enumerate(channel_presence)
                    ),
                    "channels": channel_descriptors,
                    "key": phrase_key,
                }
            )
            phrase_bars.append(end_bar - start_bar)
        section_count = current_section + 1
        _assign_phrase_motifs(phrase_rows)

    track_descriptor = {
        "trackIndex": track_index,
        "source": track["source"],
        "soundtrack": track["soundtrack"],
        "split": hygiene_track["split"],
        "componentId": hygiene_track["componentId"],
        "soundtrackBalancedWeight": hygiene_track[
            "soundtrackBalancedWeight"
        ],
        "events": len(events),
        "commandSamples": track_end,
        "durationSeconds": round(track_end / SAMPLE_RATE, 6),
        "loopKind": track.get("loopKind", "none"),
        "loopStartSample": track.get("loopStartSample"),
        "loopSamples": track.get("loopSamples", 0),
        "qualifiedTiming": qualified,
        "timingHypotheses": timing_hypothesis["hypotheses"],
        "phrases": len(phrase_rows),
        "sections": section_count,
        "phraseBars": phrase_bars,
        "motifs": (
            len({phrase["motifIndex"] for phrase in phrase_rows})
            if phrase_rows
            else 0
        ),
        "repeatedMotifs": (
            len(
                {
                    phrase["motifIndex"]
                    for phrase in phrase_rows
                    if phrase["motifOccurrences"] > 1
                }
            )
            if phrase_rows
            else 0
        ),
        "motifSequence": [
            phrase["motifIndex"] for phrase in phrase_rows
        ],
        "key": _key_descriptor(events[events[:, 1] < 3, 2]),
        "channelEvents": [
            int(np.count_nonzero(events[:, 1] == channel))
            for channel in range(4)
        ],
        "channelPresenceMask": sum(
            int(np.any(events[:, 1] == channel)) << channel
            for channel in range(4)
        ),
    }
    return output, phrase_rows, track_descriptor


def _neutral_noise_table() -> np.ndarray:
    state = 0x7FFF
    values = np.empty(32_767, dtype=np.float64)
    for index in range(len(values)):
        values[index] = 1.0 if state & 1 else -1.0
        feedback = (state ^ (state >> 1)) & 1
        state = (state >> 1) | (feedback << 14)
    return values


def render_neutral_composition(
    composition_events: np.ndarray,
    output: Path,
    maximum_seconds: float = 20,
) -> dict:
    """Render composition alone with fixed neutral channel timbres."""

    events = np.asarray(composition_events)
    maximum_samples = max(1, round(maximum_seconds * SAMPLE_RATE))
    event_end = (
        events["sample"]
        + np.maximum(1, events["untilNextTriggerSamples"])
    )
    total_samples = int(
        min(maximum_samples, max(1, int(event_end.max())))
    )
    audio = np.zeros(total_samples, dtype=np.float64)
    noise_table = _neutral_noise_table()
    for event_index, event in enumerate(events):
        start = int(event["sample"])
        if start >= total_samples:
            continue
        duration = int(max(1, event["untilNextTriggerSamples"]))
        end = min(total_samples, start + duration)
        count = end - start
        if count <= 0:
            continue
        channel = int(event["channel"])
        if channel < 3 and int(event["pitchCents"]) >= 0:
            midi = int(event["pitchCents"]) / 100
            frequency = 440 * (2 ** ((midi - 69) / 12))
            phase = (
                np.arange(count, dtype=np.float64)
                * frequency
                / SAMPLE_RATE
            )
            if channel == 0:
                signal = np.where((phase % 1) < 0.5, 1.0, -1.0)
            elif channel == 1:
                signal = np.where((phase % 1) < 0.25, 1.0, -1.0)
            else:
                signal = 1 - 4 * np.abs((phase % 1) - 0.5)
        else:
            offset = (event_index * 997) % len(noise_table)
            indices = (offset + np.arange(count)) % len(noise_table)
            signal = noise_table[indices]
        edge = min(128, max(1, count // 2))
        envelope = np.ones(count, dtype=np.float64)
        envelope[:edge] *= np.linspace(0, 1, edge, endpoint=False)
        envelope[-edge:] *= np.linspace(1, 0, edge, endpoint=False)
        amplitude = (0.035, 0.03, 0.035, 0.025)[channel]
        audio[start:end] += signal * envelope * amplitude
    peak = float(np.max(np.abs(audio)))
    if peak > 0.95:
        audio *= 0.95 / peak
        peak = 0.95
    pcm = np.rint(np.clip(audio, -1, 1) * 32767).astype("<i2")
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(pcm.tobytes())
    return {
        "schema": "chiptunes-neutral-composition-render-v1",
        "sampleRate": SAMPLE_RATE,
        "frames": len(pcm),
        "seconds": round(len(pcm) / SAMPLE_RATE, 6),
        "peak": round(peak, 9),
        "nonzeroFrames": int(np.count_nonzero(pcm)),
        "finite": bool(np.isfinite(audio).all()),
        "sha256": _sha256_file(output),
    }


def _quantiles(values) -> dict:
    values = np.asarray(list(values), dtype=np.float64)
    if not len(values):
        return {}
    return {
        str(percentile): round(float(np.percentile(values, percentile)), 6)
        for percentile in (5, 25, 50, 75, 95)
    }


def _scalar_performance_summary(
    values: np.ndarray,
    unwritten: int,
) -> dict:
    values = np.asarray(values)
    written = values[values != unwritten]
    unique, counts = np.unique(written, return_counts=True)
    probabilities = counts / max(1, counts.sum())
    entropy = (
        float(-(probabilities * np.log2(probabilities)).sum())
        if len(counts)
        else 0.0
    )
    return {
        "events": int(len(values)),
        "written": int(len(written)),
        "unwritten": int(len(values) - len(written)),
        "writtenFraction": round(
            len(written) / max(1, len(values)),
            9,
        ),
        "uniqueWrittenValues": int(len(unique)),
        "entropyBits": round(entropy, 9),
    }


def _performance_coverage(performance_path: Path) -> dict:
    performance = np.load(performance_path, mmap_mode="r")
    channels = np.asarray(performance["channel"])
    global_fields = (
        "masterLeftVolume",
        "masterRightVolume",
        "vinLeft",
        "vinRight",
        "routing",
        "masterEnabled",
    )
    channel_fields = {
        0: (
            "frequencyRegister",
            "lengthLoad",
            "lengthEnabled",
            "duty",
            "initialVolume",
            "envelopeDirection",
            "envelopeRate",
            "sweepPeriod",
            "sweepDirection",
            "sweepShift",
        ),
        1: (
            "frequencyRegister",
            "lengthLoad",
            "lengthEnabled",
            "duty",
            "initialVolume",
            "envelopeDirection",
            "envelopeRate",
        ),
        2: (
            "frequencyRegister",
            "lengthLoad",
            "lengthEnabled",
            "waveDacEnabled",
            "waveOutputLevel",
        ),
        3: (
            "lengthLoad",
            "lengthEnabled",
            "initialVolume",
            "envelopeDirection",
            "envelopeRate",
            "noiseDivisor",
            "noiseWidthMode",
            "noiseClockShift",
        ),
    }
    summaries = {}
    for channel, fields in channel_fields.items():
        selected = channels == channel
        field_summaries = {}
        for field in fields + global_fields:
            values = performance[field][selected]
            field_summaries[field] = _scalar_performance_summary(
                values,
                (
                    UNWRITTEN_U16
                    if values.dtype.itemsize == 2
                    else UNWRITTEN_U8
                ),
            )
        if channel == 2:
            wave_tables = np.asarray(performance["waveTable"][selected])
            complete = np.all(wave_tables != UNWRITTEN_U8, axis=1)
            partial = (
                np.any(wave_tables != UNWRITTEN_U8, axis=1) & ~complete
            )
            field_summaries["waveTable"] = {
                "events": int(len(wave_tables)),
                "complete": int(np.count_nonzero(complete)),
                "unwritten": int(np.count_nonzero(~np.any(
                    wave_tables != UNWRITTEN_U8,
                    axis=1,
                ))),
                "partial": int(np.count_nonzero(partial)),
                "completeFraction": round(
                    np.count_nonzero(complete)
                    / max(1, len(wave_tables)),
                    9,
                ),
                "uniqueCompleteTables": int(
                    len(np.unique(wave_tables[complete], axis=0))
                    if np.any(complete)
                    else 0
                ),
            }
        summaries[CHANNEL_NAMES[channel]] = {
            "events": int(np.count_nonzero(selected)),
            "fields": field_summaries,
        }
    _close_memmap(performance)
    diversity = {
        "pulse1DutyValues": summaries["pulse1"]["fields"]["duty"][
            "uniqueWrittenValues"
        ],
        "pulse2DutyValues": summaries["pulse2"]["fields"]["duty"][
            "uniqueWrittenValues"
        ],
        "pulseEnvelopeRateValues": min(
            summaries[channel]["fields"]["envelopeRate"][
                "uniqueWrittenValues"
            ]
            for channel in ("pulse1", "pulse2")
        ),
        "pulse1SweepShiftValues": summaries["pulse1"]["fields"][
            "sweepShift"
        ]["uniqueWrittenValues"],
        "waveOutputLevelValues": summaries["wave"]["fields"][
            "waveOutputLevel"
        ]["uniqueWrittenValues"],
        "waveTables": summaries["wave"]["fields"]["waveTable"][
            "uniqueCompleteTables"
        ],
        "noiseDivisorValues": summaries["noise"]["fields"][
            "noiseDivisor"
        ]["uniqueWrittenValues"],
        "noiseWidthValues": summaries["noise"]["fields"]["noiseWidthMode"][
            "uniqueWrittenValues"
        ],
        "noiseShiftValues": summaries["noise"]["fields"]["noiseClockShift"][
            "uniqueWrittenValues"
        ],
    }
    diversity["passed"] = (
        diversity["pulse1DutyValues"] == 4
        and diversity["pulse2DutyValues"] == 4
        and diversity["pulseEnvelopeRateValues"] >= 4
        and diversity["pulse1SweepShiftValues"] >= 4
        and diversity["waveOutputLevelValues"] >= 3
        and diversity["waveTables"] >= 100
        and diversity["noiseDivisorValues"] == 8
        and diversity["noiseWidthValues"] == 2
        and diversity["noiseShiftValues"] >= 8
    )
    return {
        "unwrittenSemantics": (
            "Sentinels mean the source stream had not written the register "
            "before this trigger; they are preserved exact categories and "
            "are never imputed."
        ),
        "channels": summaries,
        "diversity": diversity,
    }


def build_factorized_dataset(
    dataset: Path,
    timing: Path,
    hygiene: Path,
    output: Path,
) -> dict:
    dataset = dataset.resolve()
    timing = timing.resolve()
    hygiene = hygiene.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(
            f"refusing to reuse immutable factorization output {output}"
        )
    output.mkdir(parents=True)
    dataset_manifest = json.loads((dataset / "manifest.json").read_text())
    timing_manifest = json.loads((timing / "manifest.json").read_text())
    hygiene_manifest = json.loads((hygiene / "manifest.json").read_text())
    if (
        timing_manifest["sourceDatasetFingerprint"]
        != dataset_manifest["contentFingerprint"]
        or hygiene_manifest["datasetFingerprint"]
        != dataset_manifest["contentFingerprint"]
        or hygiene_manifest["timingFingerprint"]
        != timing_manifest["contentFingerprint"]
    ):
        raise RuntimeError("factorization source fingerprints do not align")

    tracks = json.loads((dataset / "tracks.json").read_text())
    hygiene_tracks = _read_jsonl(hygiene / "tracks.jsonl")
    timing_hypotheses = _read_jsonl(timing / "timing-hypotheses.jsonl")
    exact_events = np.load(dataset / "exact-events.npy", mmap_mode="r")
    trigger_states = np.load(dataset / "trigger-states.npy", mmap_mode="r")
    event_offsets_map = np.load(
        dataset / "exact-event-offsets.npy",
        mmap_mode="r",
    )
    timing_events = np.load(timing / "timing-events.npy", mmap_mode="r")
    timing_offsets_map = np.load(
        timing / "timing-offsets.npy",
        mmap_mode="r",
    )
    event_offsets = np.asarray(event_offsets_map, dtype=np.int64).copy()
    timing_offsets = np.asarray(timing_offsets_map, dtype=np.int64).copy()
    _close_memmap(event_offsets_map)
    _close_memmap(timing_offsets_map)
    del event_offsets_map, timing_offsets_map
    if (
        len(tracks) != len(hygiene_tracks)
        or len(tracks) != len(timing_hypotheses)
        or len(event_offsets) != len(tracks) + 1
        or not np.array_equal(event_offsets, timing_offsets)
        or len(exact_events) != len(trigger_states)
        or len(exact_events) != len(timing_events)
    ):
        raise RuntimeError("factorization sources do not align")

    composition_partial = output / "composition-events.partial.npy"
    composition_path = output / "composition-events.npy"
    performance_partial = output / "performance-events.partial.npy"
    performance_path = output / "performance-events.npy"
    composition = np.lib.format.open_memmap(
        composition_partial,
        mode="w+",
        dtype=COMPOSITION_EVENT_DTYPE,
        shape=(len(exact_events),),
    )
    performance = np.lib.format.open_memmap(
        performance_partial,
        mode="w+",
        dtype=PERFORMANCE_EVENT_DTYPE,
        shape=(len(exact_events),),
    )
    track_path = output / "tracks.jsonl"
    phrase_path = output / "phrases.jsonl"
    track_rows = []
    phrase_rows = []
    categorical_compared = 0
    categorical_errors = 0
    pitch_compared = 0
    pitch_errors = 0
    event_alignment_errors = 0
    qualified_without_phrases = 0
    ambiguous_with_phrases = 0
    phrase_assignment_errors = 0
    phrase_bars = []
    with (
        track_path.open("x", encoding="utf-8") as track_stream,
        phrase_path.open("x", encoding="utf-8") as phrase_stream,
    ):
        for track_index, track in enumerate(tracks):
            start, end = (
                int(event_offsets[track_index]),
                int(event_offsets[track_index + 1]),
            )
            if (
                hygiene_tracks[track_index]["trackIndex"] != track_index
                or timing_hypotheses[track_index]["trackIndex"] != track_index
                or hygiene_tracks[track_index]["source"] != track["source"]
                or timing_hypotheses[track_index]["source"] != track["source"]
            ):
                raise RuntimeError(
                    f"track ledger mismatch at index {track_index}"
                )
            event_rows = np.asarray(exact_events[start:end])
            state_rows = np.asarray(trigger_states[start:end])
            timing_rows = np.asarray(timing_events[start:end])
            event_alignment_errors += int(
                np.count_nonzero(timing_rows["sample"] != event_rows[:, 0])
            )
            decoded = decode_performance_events(event_rows, state_rows)
            performance[start:end] = decoded
            roundtrip = performance_roundtrip_audit(
                event_rows,
                state_rows,
                decoded,
            )
            categorical_compared += roundtrip[
                "categoricalRegistersCompared"
            ]
            categorical_errors += roundtrip[
                "categoricalRoundtripErrors"
            ]
            pitch_compared += roundtrip["pitchValuesCompared"]
            pitch_errors += roundtrip["pitchRoundtripErrors"]
            factored, track_phrases, track_descriptor = (
                factor_track_composition(
                    track_index,
                    track,
                    hygiene_tracks[track_index],
                    event_rows,
                    timing_rows,
                    timing_hypotheses[track_index],
                )
            )
            composition[start:end] = factored
            phrase_ids = set(map(int, np.unique(factored["phraseIndex"])))
            expected_phrase_ids = set(range(track_descriptor["phrases"]))
            if (
                track_descriptor["qualifiedTiming"]
                and phrase_ids != expected_phrase_ids
            ) or (
                not track_descriptor["qualifiedTiming"]
                and phrase_ids != {-1}
            ):
                phrase_assignment_errors += 1
            if (
                track_descriptor["qualifiedTiming"]
                and not track_descriptor["phrases"]
            ):
                qualified_without_phrases += 1
            if (
                not track_descriptor["qualifiedTiming"]
                and track_descriptor["phrases"]
            ):
                ambiguous_with_phrases += 1
            phrase_bars.extend(track_descriptor["phraseBars"])
            track_stream.write(
                json.dumps(
                    track_descriptor,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n"
            )
            for phrase in track_phrases:
                phrase_stream.write(
                    json.dumps(
                        phrase,
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    + "\n"
                )
            track_rows.append(track_descriptor)
            phrase_rows.extend(track_phrases)
            if (track_index + 1) % 100 == 0 or track_index + 1 == len(tracks):
                print(
                    f"[factorization {track_index + 1}/{len(tracks)}] "
                    f"events={end} phrases={len(phrase_rows)} "
                    f"roundtripErrors={categorical_errors + pitch_errors}",
                    flush=True,
                )

    composition.flush()
    performance.flush()
    _close_memmap(composition)
    _close_memmap(performance)
    del composition, performance
    composition_partial.replace(composition_path)
    performance_partial.replace(performance_path)
    performance_coverage = _performance_coverage(performance_path)

    preview_candidates = [
        row
        for row in track_rows
        if row["qualifiedTiming"]
        and row["channelPresenceMask"] == 15
        and row["split"] in ("validation", "test")
    ]
    if not preview_candidates:
        preview_candidates = [
            row
            for row in track_rows
            if row["qualifiedTiming"]
        ]
    preview_track = min(
        preview_candidates,
        key=lambda row: hashlib.sha256(row["source"].encode()).hexdigest(),
    )
    preview_index = preview_track["trackIndex"]
    preview_events = np.load(composition_path, mmap_mode="r")
    preview = render_neutral_composition(
        np.asarray(
            preview_events[
                int(event_offsets[preview_index]) : int(
                    event_offsets[preview_index + 1]
                )
            ]
        ),
        output / "neutral-composition-preview.wav",
    )
    _close_memmap(preview_events)
    del preview_events
    preview["trackIndex"] = preview_index
    preview["source"] = preview_track["source"]
    preview_path = output / "neutral-composition-preview.json"
    _write_json(preview_path, preview)

    _close_memmap(exact_events)
    _close_memmap(trigger_states)
    _close_memmap(timing_events)
    del exact_events, trigger_states, timing_events
    np.save(output / "event-offsets.npy", event_offsets)
    qualified_key_phrases = sum(
        phrase["key"]["qualifiedTop"] for phrase in phrase_rows
    )
    motif_return_phrases = sum(
        phrase["structuralRole"]["isMotifReturn"]
        for phrase in phrase_rows
    )
    phrases_by_split = Counter(phrase["split"] for phrase in phrase_rows)
    channel_events = np.sum(
        np.asarray(
            [row["channelEvents"] for row in track_rows],
            dtype=np.int64,
        ),
        axis=0,
    )
    audit = {
        "schema": "chiptunes-gameboy-factorization-audit-v3",
        "datasetFingerprint": dataset_manifest["contentFingerprint"],
        "timingFingerprint": timing_manifest["contentFingerprint"],
        "hygieneFingerprint": hygiene_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "events": int(event_offsets[-1]),
        "phrases": len(phrase_rows),
        "qualifiedTracks": sum(
            row["qualifiedTiming"] for row in track_rows
        ),
        "ambiguousTracks": sum(
            not row["qualifiedTiming"] for row in track_rows
        ),
        "qualifiedTracksWithoutPhrases": qualified_without_phrases,
        "ambiguousTracksWithPhrases": ambiguous_with_phrases,
        "phraseAssignmentErrors": phrase_assignment_errors,
        "phraseBars": _quantiles(phrase_bars),
        "maximumPhraseBars": max(phrase_bars, default=0),
        "phrasesBySplit": dict(sorted(phrases_by_split.items())),
        "qualifiedKeyPhrases": qualified_key_phrases,
        "qualifiedKeyPhraseFraction": round(
            qualified_key_phrases / max(1, len(phrase_rows)),
            9,
        ),
        "motifReturnPhrases": motif_return_phrases,
        "motifReturnPhraseFraction": round(
            motif_return_phrases / max(1, len(phrase_rows)),
            9,
        ),
        "harmonicBarDistance": _quantiles(
            distance
            for phrase in phrase_rows
            for distance in phrase["harmonicBarDistances"]
        ),
        "eventsByChannel": dict(zip(CHANNEL_NAMES, map(int, channel_events))),
        "performanceCoverage": performance_coverage,
        "categoricalRegistersCompared": categorical_compared,
        "categoricalRoundtripErrors": categorical_errors,
        "pitchValuesCompared": pitch_compared,
        "pitchRoundtripErrors": pitch_errors,
        "eventAlignmentErrors": event_alignment_errors,
        "neutralCompositionPreview": preview,
    }
    audit["passed"] = (
        categorical_errors == 0
        and pitch_errors == 0
        and event_alignment_errors == 0
        and qualified_without_phrases == 0
        and ambiguous_with_phrases == 0
        and phrase_assignment_errors == 0
        and performance_coverage["diversity"]["passed"]
        and preview["finite"]
        and preview["nonzeroFrames"] > 0
        and preview["peak"] <= 0.95
        and max(phrase_bars, default=0) <= MAXIMUM_PHRASE_BARS
    )
    audit_path = output / "audit.json"
    _write_json(audit_path, audit)
    offsets_path = output / "event-offsets.npy"
    manifest = {
        "schema": "chiptunes-gameboy-factorized-dataset-v3",
        "datasetFingerprint": dataset_manifest["contentFingerprint"],
        "timingFingerprint": timing_manifest["contentFingerprint"],
        "hygieneFingerprint": hygiene_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "events": int(event_offsets[-1]),
        "phrases": len(phrase_rows),
        "compositionEventsFile": composition_path.name,
        "performanceEventsFile": performance_path.name,
        "compositionEventDtype": COMPOSITION_EVENT_DTYPE.descr,
        "performanceEventDtype": PERFORMANCE_EVENT_DTYPE.descr,
        "unwrittenSentinels": {
            "uint8": UNWRITTEN_U8,
            "uint16": UNWRITTEN_U16,
            "semantics": (
                "Register not yet written by the source stream at this trigger; "
                "preserve as an exact category and never impute."
            ),
        },
        "compositionEventsSha256": _sha256_file(composition_path),
        "performanceEventsSha256": _sha256_file(performance_path),
        "eventOffsetsSha256": _sha256_file(offsets_path),
        "tracksSha256": _sha256_file(track_path),
        "phrasesSha256": _sha256_file(phrase_path),
        "neutralPreviewWavSha256": preview["sha256"],
        "neutralPreviewReportSha256": _sha256_file(preview_path),
        "auditSha256": _sha256_file(audit_path),
        "auditPassed": audit["passed"],
    }
    manifest["contentFingerprint"] = hashlib.sha256(
        "".join(
            str(manifest[key])
            for key in (
                "datasetFingerprint",
                "timingFingerprint",
                "hygieneFingerprint",
                "compositionEventsSha256",
                "performanceEventsSha256",
                "eventOffsetsSha256",
                "tracksSha256",
                "phrasesSha256",
                "neutralPreviewWavSha256",
                "neutralPreviewReportSha256",
                "auditSha256",
            )
        ).encode()
    ).hexdigest()
    _write_json(output / "manifest.json", manifest)
    print(
        json.dumps({"manifest": manifest, "audit": audit}, indent=2),
        flush=True,
    )
    if not audit["passed"]:
        raise RuntimeError("composition/performance factorization audit failed")
    return manifest
