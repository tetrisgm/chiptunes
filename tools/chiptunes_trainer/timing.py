from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np


SAMPLE_RATE = 44_100
BPM_MIN = 48.0
BPM_MAX = 320.0
BPM_STEP = 0.5
METERS = (2, 3, 4, 6, 8)
HYPOTHESES_PER_TRACK = 6
MAX_PHASE_EVENTS = 16_384
MAX_IOI_SECONDS = 8.0
IOI_BIN_SAMPLES = SAMPLE_RATE / 500
IOI_BINS = round(MAX_IOI_SECONDS * SAMPLE_RATE / IOI_BIN_SAMPLES) + 1
TEMPO_PROBES = (
    (0.25, 0.24),
    (1 / 3, 0.18),
    (0.5, 0.58),
    (2 / 3, 0.24),
    (0.75, 0.20),
    (1.0, 1.0),
    (1.5, 0.30),
    (2.0, 0.68),
    (3.0, 0.25),
    (4.0, 0.36),
    (6.0, 0.16),
    (8.0, 0.12),
)


@dataclass(frozen=True)
class TempoHypothesis:
    bpm_milli: int
    beats_per_bar: int
    phase_sample: int
    score: float
    tempo_score: float
    grid_score: float
    metrical_score: float
    loop_score: float
    harmonic_score: float
    phrase_score: float
    loop_phase_error_samples: float | None
    loop_phase_error_fine_steps: float | None
    confidence: float = 0.0
    qualified: bool = False

    @property
    def bpm(self) -> float:
        return self.bpm_milli / 1_000

    def as_dict(self, rank: int) -> dict:
        bar_numerator = SAMPLE_RATE * 60 * 1_000 * self.beats_per_bar
        return {
            "rank": rank,
            "bpm": self.bpm,
            "bpmMilli": self.bpm_milli,
            "beatsPerBar": self.beats_per_bar,
            "phaseSample": self.phase_sample,
            "barSamplesNumerator": bar_numerator,
            "barSamplesDenominator": self.bpm_milli,
            "score": round(self.score, 9),
            "confidence": round(self.confidence, 9),
            "qualified": self.qualified,
            "evidence": {
                "tempo": round(self.tempo_score, 9),
                "grid": round(self.grid_score, 9),
                "metrical": round(self.metrical_score, 9),
                "loop": round(self.loop_score, 9),
                "harmonic": round(self.harmonic_score, 9),
                "phrase": round(self.phrase_score, 9),
            },
            "loopPhaseErrorSamples": (
                round(self.loop_phase_error_samples, 6)
                if self.loop_phase_error_samples is not None
                else None
            ),
            "loopPhaseErrorFineSteps": (
                round(self.loop_phase_error_fine_steps, 9)
                if self.loop_phase_error_fine_steps is not None
                else None
            ),
        }


def timing_event_dtype(hypotheses: int = HYPOTHESES_PER_TRACK) -> np.dtype:
    fields: list[tuple[str, str]] = [
        ("sample", "<i8"),
        ("deltaSamples", "<i8"),
        ("secondsMicros", "<i8"),
        ("region", "u1"),
        ("sectionRelativeSample", "<i8"),
    ]
    for index in range(hypotheses):
        fields.extend(
            [
                (f"h{index}FineGrid", "<i4"),
                (f"h{index}CoarseGrid", "<i4"),
                (f"h{index}ResidualSamples", "<i4"),
            ]
        )
    return np.dtype(fields)


def _round_divide(values, denominator: int):
    values = np.asarray(values, dtype=np.int64)
    absolute = np.abs(values)
    rounded = (2 * absolute + denominator) // (2 * denominator)
    return np.where(values < 0, -rounded, rounded)


def project_samples(
    samples: np.ndarray,
    hypothesis: TempoHypothesis,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project exact samples to coarse/fine grids and an exact residual."""

    relative = np.asarray(samples, dtype=np.int64) - hypothesis.phase_sample
    bar_numerator = SAMPLE_RATE * 60 * 1_000 * hypothesis.beats_per_bar
    fine_denominator = bar_numerator
    fine_values = relative * hypothesis.bpm_milli * 128
    coarse_values = relative * hypothesis.bpm_milli * 32
    fine_grid = _round_divide(fine_values, fine_denominator)
    coarse_grid = _round_divide(coarse_values, fine_denominator)
    snapped = _round_divide(
        fine_grid * bar_numerator,
        hypothesis.bpm_milli * 128,
    )
    residual = relative - snapped
    return (
        fine_grid.astype(np.int32),
        coarse_grid.astype(np.int32),
        residual.astype(np.int32),
    )


def restore_samples(
    fine_grid: np.ndarray,
    residual: np.ndarray,
    hypothesis: TempoHypothesis,
) -> np.ndarray:
    bar_numerator = SAMPLE_RATE * 60 * 1_000 * hypothesis.beats_per_bar
    snapped = _round_divide(
        np.asarray(fine_grid, dtype=np.int64) * bar_numerator,
        hypothesis.bpm_milli * 128,
    )
    return hypothesis.phase_sample + snapped + np.asarray(residual, dtype=np.int64)


def _even_selection(length: int, maximum: int) -> np.ndarray:
    if length <= maximum:
        return np.arange(length)
    return np.linspace(0, length - 1, maximum, dtype=np.int64)


def _unique_onsets(rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    samples = np.asarray(rows[:, 0], dtype=np.int64)
    channels = np.asarray(rows[:, 1], dtype=np.int64)
    velocity = np.asarray(rows[:, 3], dtype=np.float64) / 32_767
    unique, starts, counts = np.unique(samples, return_index=True, return_counts=True)
    event_weight = 1.0 + 0.25 * (channels == 3) + 0.25 * velocity
    weights = np.add.reduceat(event_weight, starts)
    weights *= 1.0 + 0.15 * np.maximum(0, counts - 1)
    if len(unique) > 1:
        gaps = np.diff(unique, prepend=unique[0])
        positive = gaps[gaps > 0]
        median_gap = float(np.median(positive)) if len(positive) else 1.0
        gap_accent = np.clip(gaps / max(1.0, median_gap * 4), 0, 1)
        weights *= 1.0 + 0.25 * gap_accent
    return unique, weights


def _add_interval_pairs(
    histogram: np.ndarray,
    samples: np.ndarray,
    weights: np.ndarray,
    lags: tuple[int, ...],
    lane_weight: float,
) -> None:
    maximum = round(MAX_IOI_SECONDS * SAMPLE_RATE)
    for lag in lags:
        if len(samples) <= lag:
            continue
        differences = samples[lag:] - samples[:-lag]
        valid = (differences > 0) & (differences <= maximum)
        if not np.any(valid):
            continue
        bins = np.rint(differences[valid] / IOI_BIN_SAMPLES).astype(np.int64)
        pair_weight = (
            np.sqrt(weights[lag:][valid] * weights[:-lag][valid])
            * lane_weight
            / math.sqrt(lag)
        )
        histogram += np.bincount(
            bins,
            weights=pair_weight,
            minlength=len(histogram),
        )[: len(histogram)]


def _interval_profiles(
    rows: np.ndarray,
    unique_samples: np.ndarray,
    unique_weights: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    onset = np.zeros(IOI_BINS, dtype=np.float64)
    accent = np.zeros(IOI_BINS, dtype=np.float64)
    _add_interval_pairs(
        onset,
        unique_samples,
        np.ones_like(unique_weights),
        (1, 2, 3, 4, 6, 8, 12, 16),
        0.6,
    )
    center = float(np.median(unique_weights))
    prominence = np.maximum(0, unique_weights - center)
    if np.count_nonzero(prominence) < 4:
        threshold = float(np.percentile(unique_weights, 75))
        prominence = np.where(unique_weights >= threshold, unique_weights, 0)
    if np.count_nonzero(prominence) < 2:
        prominence = unique_weights.copy()
    accented = prominence > 0
    _add_interval_pairs(
        accent,
        unique_samples[accented],
        prominence[accented],
        (1, 2, 3, 4, 6, 8),
        1.0,
    )
    for channel in range(4):
        lane_samples = np.unique(np.asarray(rows[rows[:, 1] == channel, 0], dtype=np.int64))
        lane_weights = np.ones(len(lane_samples), dtype=np.float64)
        lane_weight = 1.15 if channel == 3 else 1.0
        _add_interval_pairs(
            onset,
            lane_samples,
            lane_weights,
            (1, 2, 3, 4, 6, 8),
            lane_weight,
        )
    kernel = np.asarray([1, 2, 4, 2, 1], dtype=np.float64)
    kernel /= kernel.sum()
    for _ in range(2):
        onset = np.convolve(onset, kernel, mode="same")
        accent = np.convolve(accent, kernel, mode="same")
    if onset.max() > 0:
        onset /= onset.max()
    if accent.max() > 0:
        accent /= accent.max()
    return onset, accent


def _sample_profile(profile: np.ndarray, seconds: np.ndarray) -> np.ndarray:
    positions = seconds * SAMPLE_RATE / IOI_BIN_SAMPLES
    return np.interp(
        positions,
        np.arange(len(profile), dtype=np.float64),
        profile,
        left=0.0,
        right=0.0,
    )


def _tempo_scores(
    bpms: np.ndarray,
    onset_profile: np.ndarray,
    accent_profile: np.ndarray,
) -> np.ndarray:
    beats = 60 / np.asarray(bpms, dtype=np.float64)
    fractions = np.asarray([probe[0] for probe in TEMPO_PROBES])
    weights = np.asarray([probe[1] for probe in TEMPO_PROBES])
    durations = beats[:, None] * fractions[None, :]
    onset = _sample_profile(onset_profile, durations.reshape(-1)).reshape(durations.shape)
    accent = _sample_profile(accent_profile, durations.reshape(-1)).reshape(durations.shape)
    onset_score = (onset * weights).sum(axis=1) / weights.sum()
    accent_weights = np.asarray(
        [0.08, 0.06, 0.12, 0.08, 0.08, 1.0, 0.28, 0.82, 0.42, 0.52, 0.22, 0.16]
    )
    accent_score = (accent * accent_weights).sum(axis=1) / accent_weights.sum()
    scores = 0.34 * onset_score + 0.66 * accent_score
    maximum = scores.max(initial=0)
    return scores / maximum if maximum else scores


def _tempo_candidates(
    onset_profile: np.ndarray,
    accent_profile: np.ndarray,
    maximum: int = 24,
) -> list[tuple[int, float]]:
    bpms = np.arange(BPM_MIN, BPM_MAX + BPM_STEP / 2, BPM_STEP)
    scores = _tempo_scores(bpms, onset_profile, accent_profile)
    order = np.argsort(-scores, kind="stable")
    selected: list[int] = []
    for index in order:
        bpm_milli = round(float(bpms[index]) * 1_000)
        tempo_window = max(5_000, round(bpm_milli * 0.03))
        if all(abs(bpm_milli - prior) >= tempo_window for prior in selected):
            selected.append(bpm_milli)
        if len(selected) >= maximum - 4:
            break
    anchors = selected[:6]
    for bpm_milli in anchors:
        for alternative in (bpm_milli // 2, bpm_milli * 2):
            if not round(BPM_MIN * 1_000) <= alternative <= round(BPM_MAX * 1_000):
                continue
            nearest = round(alternative / 500) * 500
            tempo_window = max(5_000, round(nearest * 0.03))
            if all(abs(nearest - prior) >= tempo_window for prior in selected):
                selected.append(nearest)
    candidate_bpms = np.asarray(sorted(set(selected)), dtype=np.float64) / 1_000
    candidate_scores = _tempo_scores(candidate_bpms, onset_profile, accent_profile)
    ranked = sorted(
        zip((candidate_bpms * 1_000).round().astype(int), candidate_scores),
        key=lambda row: (-row[1], row[0]),
    )
    return [(int(bpm), float(score)) for bpm, score in ranked[:maximum]]


def _circular_concentration(
    samples: np.ndarray,
    weights: np.ndarray,
    period: float,
) -> float:
    if period <= 0 or not len(samples):
        return 0.0
    angles = np.remainder(samples, period) / period * (2 * math.pi)
    vector = np.sum(weights * np.exp(1j * angles))
    return float(abs(vector) / max(1e-12, weights.sum()))


def _circular_offset(
    samples: np.ndarray,
    weights: np.ndarray,
    period: float,
) -> float:
    angles = np.remainder(samples, period) / period * (2 * math.pi)
    vector = np.sum(weights * np.exp(1j * angles))
    if abs(vector) < 1e-12:
        return 0.0
    angle = math.atan2(vector.imag, vector.real)
    return (angle % (2 * math.pi)) / (2 * math.pi) * period


def _circular_distance(steps: np.ndarray, target: float, period: int = 128) -> np.ndarray:
    difference = np.abs(steps - target)
    return np.minimum(difference, period - difference)


def _metrical_template(beats_per_bar: int) -> np.ndarray:
    steps = np.arange(128, dtype=np.float64)
    template = np.exp(-0.5 * (_circular_distance(steps, 0) / 1.4) ** 2)
    for beat in range(1, beats_per_bar):
        position = beat * 128 / beats_per_bar
        template += 0.52 * np.exp(
            -0.5 * (_circular_distance(steps, position) / 1.4) ** 2
        )
    for half in range(beats_per_bar * 2):
        position = half * 128 / (beats_per_bar * 2)
        template += 0.19 * np.exp(
            -0.5 * (_circular_distance(steps, position) / 1.2) ** 2
        )
    for quarter in range(beats_per_bar * 4):
        position = quarter * 128 / (beats_per_bar * 4)
        template += 0.06 * np.exp(
            -0.5 * (_circular_distance(steps, position) / 0.9) ** 2
        )
    return template / template.max()


def _downbeat_template() -> np.ndarray:
    steps = np.arange(128, dtype=np.float64)
    return np.exp(-0.5 * (_circular_distance(steps, 0) / 1.8) ** 2)


def _change_and_boundary_samples(rows: np.ndarray, unique_samples: np.ndarray):
    harmonic_samples = []
    harmonic_weights = []
    for channel in range(3):
        lane = rows[(rows[:, 1] == channel) & (rows[:, 2] >= 0)]
        if len(lane) < 2:
            continue
        pitch_change = np.abs(np.diff(lane[:, 2])) / 100
        patch_change = np.diff(lane[:, 4]) != 0
        changed = (pitch_change >= 1) | patch_change
        harmonic_samples.extend(np.asarray(lane[1:, 0][changed], dtype=np.int64))
        harmonic_weights.extend(
            np.clip(pitch_change[changed] / 12, 0.2, 1.0)
            + 0.35 * patch_change[changed]
        )
    if len(unique_samples) < 2:
        return (
            np.asarray(harmonic_samples, dtype=np.int64),
            np.asarray(harmonic_weights, dtype=np.float64),
            np.empty(0, dtype=np.int64),
            np.empty(0, dtype=np.float64),
        )
    gaps = np.diff(unique_samples)
    positive = gaps[gaps > 0]
    median = float(np.median(positive)) if len(positive) else 1.0
    threshold = max(0.4 * SAMPLE_RATE, median * 4)
    boundary = gaps >= threshold
    boundary_samples = unique_samples[1:][boundary]
    boundary_weights = np.clip(gaps[boundary] / max(threshold, 1), 1, 4)
    return (
        np.asarray(harmonic_samples, dtype=np.int64),
        np.asarray(harmonic_weights, dtype=np.float64),
        np.asarray(boundary_samples, dtype=np.int64),
        np.asarray(boundary_weights, dtype=np.float64),
    )


def _shift_score(histogram: np.ndarray, template: np.ndarray) -> np.ndarray:
    total = histogram.sum()
    if total <= 0:
        return np.zeros(128, dtype=np.float64)
    raw = np.asarray(
        [
            float(np.dot(histogram, np.roll(template, shift)) / total)
            for shift in range(128)
        ]
    )
    # Dense meters have more template peaks. Compare enrichment over the
    # meter-specific uniform baseline so 6/8-beat hypotheses do not win merely
    # by covering more of the bar.
    baseline = float(template.mean())
    scale = max(1e-12, float(template.max()) - baseline)
    return np.clip((raw - baseline) / scale, 0, 1)


def _evidence_histogram(
    samples: np.ndarray,
    weights: np.ndarray,
    offset: float,
    fine_step: float,
) -> np.ndarray:
    if not len(samples):
        return np.zeros(128, dtype=np.float64)
    steps = np.rint((samples - offset) / fine_step).astype(np.int64) % 128
    return np.bincount(steps, weights=weights, minlength=128).astype(np.float64)


def _expand_candidate(
    samples: np.ndarray,
    weights: np.ndarray,
    harmonic_samples: np.ndarray,
    harmonic_weights: np.ndarray,
    boundary_samples: np.ndarray,
    boundary_weights: np.ndarray,
    tempo: tuple[int, float],
    beats_per_bar: int,
    track: dict,
) -> TempoHypothesis:
    bpm_milli, tempo_score = tempo
    bpm = bpm_milli / 1_000
    beat_samples = SAMPLE_RATE * 60 / bpm
    bar_samples = beat_samples * beats_per_bar
    fine_step = bar_samples / 128
    offset = _circular_offset(samples, weights, fine_step)
    onset_histogram = _evidence_histogram(samples, weights, offset, fine_step)
    harmonic_histogram = _evidence_histogram(
        harmonic_samples,
        harmonic_weights,
        offset,
        fine_step,
    )
    boundary_histogram = _evidence_histogram(
        boundary_samples,
        boundary_weights,
        offset,
        fine_step,
    )
    metrical_by_shift = _shift_score(
        onset_histogram,
        _metrical_template(beats_per_bar),
    )
    harmonic_by_shift = _shift_score(harmonic_histogram, _downbeat_template())
    boundary_by_shift = _shift_score(boundary_histogram, _downbeat_template())
    combined = (
        0.72 * metrical_by_shift
        + 0.17 * harmonic_by_shift
        + 0.11 * boundary_by_shift
    )
    downbeat_step = int(np.argmax(combined))
    phase_sample = round((offset + downbeat_step * fine_step) % bar_samples)
    grid_score = (
        0.62 * _circular_concentration(samples, weights, beat_samples / 4)
        + 0.38 * _circular_concentration(samples, weights, beat_samples / 8)
    )
    metrical_score = float(metrical_by_shift[downbeat_step])
    harmonic_score = float(harmonic_by_shift[downbeat_step])
    phrase_score = float(boundary_by_shift[downbeat_step])
    loop_error = None
    loop_error_steps = None
    loop_score = 0.5
    loop_samples = int(track.get("loopSamples") or 0)
    loop_start = track.get("loopStartSample")
    if track.get("loopValid") and loop_samples > 0 and loop_start is not None:
        loop_bars = max(1, round(loop_samples / bar_samples))
        loop_error = abs(loop_samples - loop_bars * bar_samples)
        loop_error_steps = loop_error / fine_step
        length_score = math.exp(-0.5 * (loop_error_steps / 1.5) ** 2)
        loop_start_step = (int(loop_start) - phase_sample) / fine_step
        start_error = abs(loop_start_step - round(loop_start_step / 128) * 128)
        start_error = min(start_error, 128 - min(128, start_error))
        start_score = math.exp(-0.5 * (start_error / 2.0) ** 2)
        loop_score = 0.72 * length_score + 0.28 * start_score
        score = (
            0.40 * tempo_score
            + 0.18 * grid_score
            + 0.12 * metrical_score
            + 0.22 * loop_score
            + 0.05 * harmonic_score
            + 0.03 * phrase_score
        )
    else:
        score = (
            0.55 * tempo_score
            + 0.25 * grid_score
            + 0.15 * metrical_score
            + 0.03 * harmonic_score
            + 0.02 * phrase_score
        )
    return TempoHypothesis(
        bpm_milli=bpm_milli,
        beats_per_bar=beats_per_bar,
        phase_sample=phase_sample,
        score=float(score),
        tempo_score=float(tempo_score),
        grid_score=float(grid_score),
        metrical_score=metrical_score,
        loop_score=float(loop_score),
        harmonic_score=harmonic_score,
        phrase_score=phrase_score,
        loop_phase_error_samples=loop_error,
        loop_phase_error_fine_steps=loop_error_steps,
    )


def _with_confidence(
    hypotheses: list[TempoHypothesis],
) -> list[TempoHypothesis]:
    scores = np.asarray([hypothesis.score for hypothesis in hypotheses])
    probabilities = np.exp((scores - scores.max()) / 0.035)
    probabilities /= probabilities.sum()
    margin = scores[0] - scores[1] if len(scores) > 1 else 0
    result = []
    for index, (hypothesis, probability) in enumerate(
        zip(hypotheses, probabilities)
    ):
        quality = (
            0.42 * hypothesis.tempo_score
            + 0.24 * hypothesis.grid_score
            + 0.19 * hypothesis.metrical_score
            + 0.15 * hypothesis.loop_score
        )
        loop_stable = (
            hypothesis.loop_phase_error_fine_steps is None
            or hypothesis.loop_phase_error_fine_steps <= 2.0
        )
        qualified = bool(
            index == 0
            and quality >= 0.34
            and margin >= 0.025
            and hypothesis.grid_score >= 0.20
            and hypothesis.metrical_score >= 0.15
            and loop_stable
        )
        result.append(
            TempoHypothesis(
                **{
                    **hypothesis.__dict__,
                    "confidence": float(probability),
                    "qualified": qualified,
                }
            )
        )
    return result


def infer_timing_hypotheses(
    exact_events: np.ndarray,
    track: dict,
    hypotheses: int = HYPOTHESES_PER_TRACK,
) -> list[TempoHypothesis]:
    rows = np.asarray(exact_events, dtype=np.int64)
    if len(rows) < 2:
        raise ValueError(f"{track.get('source', '<track>')}: fewer than two exact events")
    unique_samples, unique_weights = _unique_onsets(rows)
    onset_profile, accent_profile = _interval_profiles(
        rows,
        unique_samples,
        unique_weights,
    )
    selection = _even_selection(len(unique_samples), MAX_PHASE_EVENTS)
    phase_samples = unique_samples[selection]
    phase_weights = unique_weights[selection]
    harmonic_samples, harmonic_weights, boundary_samples, boundary_weights = (
        _change_and_boundary_samples(rows, unique_samples)
    )
    tempos = _tempo_candidates(onset_profile, accent_profile)
    expanded = [
        _expand_candidate(
            phase_samples,
            phase_weights,
            harmonic_samples,
            harmonic_weights,
            boundary_samples,
            boundary_weights,
            tempo,
            meter,
            track,
        )
        for tempo in tempos
        for meter in METERS
    ]
    expanded.sort(
        key=lambda row: (
            -row.score,
            -row.tempo_score,
            row.bpm_milli,
            row.beats_per_bar,
        )
    )
    selected = [expanded[0]]
    equivalent_targets = []
    if expanded[0].beats_per_bar % 2 == 0:
        equivalent_targets.append(
            (
                expanded[0].bpm_milli // 2,
                expanded[0].beats_per_bar // 2,
            )
        )
    if expanded[0].beats_per_bar * 2 in METERS:
        equivalent_targets.append(
            (
                expanded[0].bpm_milli * 2,
                expanded[0].beats_per_bar * 2,
            )
        )
    for target_bpm, target_meter in equivalent_targets:
        if not round(BPM_MIN * 1_000) <= target_bpm <= round(BPM_MAX * 1_000):
            continue
        alternatives = [
            candidate
            for candidate in expanded
            if candidate.beats_per_bar == target_meter
            and abs(candidate.bpm_milli - target_bpm)
            <= max(2_000, round(target_bpm * 0.035))
        ]
        if alternatives:
            selected.append(max(alternatives, key=lambda row: row.score))
    for target in (expanded[0].bpm_milli // 2, expanded[0].bpm_milli * 2):
        if not round(BPM_MIN * 1_000) <= target <= round(BPM_MAX * 1_000):
            continue
        alternatives = [
            candidate
            for candidate in expanded
            if abs(candidate.bpm_milli - target) <= max(2_000, round(target * 0.035))
        ]
        if alternatives:
            alternative = max(alternatives, key=lambda row: row.score)
            if alternative not in selected:
                selected.append(alternative)
    for candidate in expanded:
        # Adjacent 0.5 BPM peaks are refinements of one clock, not distinct
        # musical hypotheses. Reserve the six slots for materially different
        # tempo families and their bar-equivalent octave interpretations.
        tempo_window = max(5_000, round(candidate.bpm_milli * 0.03))
        if any(
            abs(candidate.bpm_milli - prior.bpm_milli) < tempo_window
            and candidate.beats_per_bar == prior.beats_per_bar
            for prior in selected
        ):
            continue
        if (
            sum(
                abs(candidate.bpm_milli - prior.bpm_milli) < tempo_window
                for prior in selected
            )
            >= 2
        ):
            continue
        selected.append(candidate)
        if len(selected) == hypotheses:
            break
    if len(selected) < hypotheses:
        raise RuntimeError(
            f"{track.get('source', '<track>')}: only {len(selected)} timing hypotheses"
        )
    selected.sort(
        key=lambda row: (
            -row.score,
            -row.tempo_score,
            row.bpm_milli,
            row.beats_per_bar,
        )
    )
    return _with_confidence(selected)


def _quantiles(values) -> dict:
    values = np.asarray(list(values), dtype=np.float64)
    if not len(values):
        return {str(percentile): 0.0 for percentile in (5, 25, 50, 75, 95)}
    return {
        str(percentile): round(float(np.percentile(values, percentile)), 6)
        for percentile in (5, 25, 50, 75, 95)
    }


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


def _octave_alternative(
    hypotheses: list[TempoHypothesis],
    target: float,
) -> TempoHypothesis | None:
    candidates = [
        hypothesis
        for hypothesis in hypotheses
        if abs(hypothesis.bpm - target) <= max(2.0, target * 0.035)
    ]
    return max(candidates, key=lambda row: row.score, default=None)


def _tempo_family_count(hypotheses: list[TempoHypothesis]) -> int:
    representatives = []
    for bpm in sorted(hypothesis.bpm for hypothesis in hypotheses):
        if all(abs(bpm - prior) >= max(5.0, bpm * 0.03) for prior in representatives):
            representatives.append(bpm)
    return len(representatives)


def _representative_track_indices(
    tracks: list[dict],
    maximum_tracks: int,
) -> list[int]:
    groups = {
        kind: [
            index
            for index, track in enumerate(tracks)
            if track.get("loopKind", "none") == kind
        ]
        for kind in ("none", "intro-plus-loop", "loop-from-start")
    }
    populated = [indices for indices in groups.values() if indices]
    if not populated:
        return []
    selected = []
    per_group = max(1, math.ceil(maximum_tracks / len(populated)))
    for indices in populated:
        ordered = sorted(
            indices,
            key=lambda index: (
                tracks[index].get("exactEvents", 0),
                tracks[index]["source"],
            ),
        )
        positions = _even_selection(len(ordered), min(per_group, len(ordered)))
        selected.extend(ordered[int(position)] for position in positions)
    selected = sorted(
        set(selected),
        key=lambda index: hashlib.sha256(
            tracks[index]["source"].encode()
        ).hexdigest(),
    )
    return selected[:maximum_tracks]


def audit_timing_pilot(
    dataset: Path,
    output: Path,
    tracks_to_audit: int = 96,
) -> dict:
    dataset = dataset.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable timing pilot {output}")
    source_manifest = json.loads((dataset / "manifest.json").read_text())
    tracks = json.loads((dataset / "tracks.json").read_text())
    exact_events = np.load(dataset / "exact-events.npy", mmap_mode="r")
    offsets = np.load(dataset / "exact-event-offsets.npy", mmap_mode="r")
    offset_values = np.asarray(offsets, dtype=np.int64).copy()
    _close_memmap(offsets)
    del offsets
    indices = _representative_track_indices(tracks, tracks_to_audit)
    if not indices:
        raise RuntimeError("timing pilot selected no tracks")
    started = time.perf_counter()
    rows = []
    restoration_failures = 0
    for position, track_index in enumerate(indices, 1):
        track = tracks[track_index]
        start, end = (
            int(offset_values[track_index]),
            int(offset_values[track_index + 1]),
        )
        event_rows = np.asarray(exact_events[start:end])
        samples = np.asarray(event_rows[:, 0], dtype=np.int64)
        hypotheses = infer_timing_hypotheses(event_rows, track)
        for hypothesis in hypotheses:
            fine, _, residual = project_samples(samples, hypothesis)
            restored = restore_samples(fine, residual, hypothesis)
            restoration_failures += int(np.count_nonzero(restored != samples))
        top = hypotheses[0]
        half = _octave_alternative(hypotheses, top.bpm / 2)
        double = _octave_alternative(hypotheses, top.bpm * 2)
        rows.append(
            {
                "trackIndex": track_index,
                "source": track["source"],
                "soundtrack": track["soundtrack"],
                "split": track["split"],
                "loopKind": track.get("loopKind", "none"),
                "events": len(event_rows),
                "legacyBpm": track["bpm"],
                "topBpm": top.bpm,
                "topMeter": top.beats_per_bar,
                "topScore": round(top.score, 9),
                "topConfidence": round(top.confidence, 9),
                "qualifiedTop": top.qualified,
                "tempoFamilies": _tempo_family_count(hypotheses),
                "topEvidence": top.as_dict(0)["evidence"],
                "halfTimeScore": round(half.score, 9) if half else None,
                "doubleTimeScore": round(double.score, 9) if double else None,
                "hypotheses": [
                    {
                        "bpm": hypothesis.bpm,
                        "beatsPerBar": hypothesis.beats_per_bar,
                        "score": round(hypothesis.score, 9),
                        "tempoScore": round(hypothesis.tempo_score, 9),
                        "gridScore": round(hypothesis.grid_score, 9),
                        "metricalScore": round(hypothesis.metrical_score, 9),
                        "loopScore": round(hypothesis.loop_score, 9),
                    }
                    for hypothesis in hypotheses
                ],
            }
        )
        print(
            f"[timing-pilot {position}/{len(indices)}] "
            f"top={top.bpm:g} bpm meter={top.beats_per_bar}",
            flush=True,
        )
    elapsed = time.perf_counter() - started
    _close_memmap(exact_events)
    del exact_events, event_rows, samples
    top_bpms = [row["topBpm"] for row in rows]
    report = {
        "schema": "chiptunes-gameboy-dual-clock-pilot-v1",
        "sourceDataset": str(dataset),
        "sourceDatasetFingerprint": source_manifest["contentFingerprint"],
        "selection": "loop-kind stratified, event-density quantiles, source-hash order",
        "tracks": len(rows),
        "events": sum(row["events"] for row in rows),
        "elapsedSeconds": round(elapsed, 3),
        "estimatedFullCorpusMinutes": round(
            elapsed / len(rows) * len(tracks) / 60,
            2,
        ),
        "restorationFailures": restoration_failures,
        "hypothesesPerTrack": HYPOTHESES_PER_TRACK,
        "minimumDistinctTempoFamilies": min(row["tempoFamilies"] for row in rows),
        "tracksWithAtLeastTwoTempoFamilies": sum(
            row["tempoFamilies"] >= 2 for row in rows
        ),
        "topBpm": _quantiles(top_bpms),
        "topBpmBoundaryCounts": {
            "atMinimum": sum(bpm == BPM_MIN for bpm in top_bpms),
            "atMaximum": sum(bpm == BPM_MAX for bpm in top_bpms),
        },
        "topMeterCounts": {
            str(meter): sum(row["topMeter"] == meter for row in rows)
            for meter in METERS
        },
        "qualifiedTracks": sum(row["qualifiedTop"] for row in rows),
        "ambiguousTracks": sum(not row["qualifiedTop"] for row in rows),
        "fastTopTracks": sum(row["topBpm"] >= 180 for row in rows),
        "tracksWithHalfTimeAlternative": sum(
            row["halfTimeScore"] is not None for row in rows
        ),
        "tracksWithDoubleTimeAlternative": sum(
            row["doubleTimeScore"] is not None for row in rows
        ),
        "rows": rows,
    }
    report["passed"] = (
        restoration_failures == 0
        and all(len(row["hypotheses"]) == HYPOTHESES_PER_TRACK for row in rows)
        and all(row["tempoFamilies"] >= 2 for row in rows)
        and report["topBpmBoundaryCounts"]["atMinimum"] < len(rows) / 3
        and report["topBpmBoundaryCounts"]["atMaximum"] < len(rows) / 3
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, indent=2))
    if not report["passed"]:
        raise RuntimeError("dual-clock timing pilot failed")
    return report


def build_timing_dataset(
    dataset: Path,
    output: Path,
    hypotheses_per_track: int = HYPOTHESES_PER_TRACK,
) -> dict:
    dataset = dataset.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable timing output {output}")
    output.mkdir(parents=True)
    source_manifest = json.loads((dataset / "manifest.json").read_text())
    tracks = json.loads((dataset / "tracks.json").read_text())
    exact_events = np.load(dataset / "exact-events.npy", mmap_mode="r")
    offsets = np.load(dataset / "exact-event-offsets.npy", mmap_mode="r")
    if len(offsets) != len(tracks) + 1 or int(offsets[-1]) != len(exact_events):
        raise RuntimeError("exact event offsets do not align with the source dataset")
    event_count = int(len(exact_events))
    offset_values = np.asarray(offsets, dtype=np.int64).copy()
    _close_memmap(offsets)
    del offsets
    partial_events = output / "timing-events.partial.npy"
    final_events = output / "timing-events.npy"
    timing_events = np.lib.format.open_memmap(
        partial_events,
        mode="w+",
        dtype=timing_event_dtype(hypotheses_per_track),
        shape=(len(exact_events),),
    )
    hypotheses_partial = output / "timing-hypotheses.partial.jsonl"
    hypotheses_final = output / "timing-hypotheses.jsonl"
    top_bpms = []
    top_meters = []
    top_confidences = []
    loop_errors = []
    qualified_loop_errors = []
    track_residual_p95 = []
    ambiguous_tracks = 0
    multiple_hypothesis_tracks = 0
    unqualified_single_hypothesis_tracks = 0
    restoration_failures = 0
    fast_top_tracks = 0
    fast_with_weaker_half = 0
    fast_retained_when_half_weaker = 0
    octave_alternative_tracks = 0
    tempo_family_counts = []
    soundtrack_rows: dict[str, dict] = {}
    with hypotheses_partial.open("x", encoding="utf-8") as hypothesis_stream:
        for track_index, track in enumerate(tracks):
            start, end = (
                int(offset_values[track_index]),
                int(offset_values[track_index + 1]),
            )
            rows = np.asarray(exact_events[start:end])
            samples = np.asarray(rows[:, 0], dtype=np.int64)
            hypotheses = infer_timing_hypotheses(
                rows,
                track,
                hypotheses_per_track,
            )
            top = hypotheses[0]
            record = {
                "trackIndex": track_index,
                "source": track["source"],
                "soundtrack": track["soundtrack"],
                "split": track["split"],
                "legacyBpm": track["bpm"],
                "qualifiedTop": top.qualified,
                "ambiguous": not top.qualified,
                "hypotheses": [
                    hypothesis.as_dict(rank)
                    for rank, hypothesis in enumerate(hypotheses)
                ],
            }
            hypothesis_stream.write(json.dumps(record, separators=(",", ":")) + "\n")
            destination = timing_events[start:end]
            destination["sample"] = samples
            destination["deltaSamples"] = np.diff(samples, prepend=0)
            destination["secondsMicros"] = _round_divide(
                samples * 1_000_000,
                SAMPLE_RATE,
            )
            loop_start = track.get("loopStartSample")
            if track.get("loopValid") and loop_start is not None:
                loop_start = int(loop_start)
                in_loop = samples >= loop_start
                destination["region"] = np.where(in_loop, 1, 0)
                destination["sectionRelativeSample"] = np.where(
                    in_loop,
                    samples - loop_start,
                    samples,
                )
            else:
                destination["region"] = 2
                destination["sectionRelativeSample"] = samples
            absolute_residuals = []
            for hypothesis_index, hypothesis in enumerate(hypotheses):
                fine, coarse, residual = project_samples(samples, hypothesis)
                destination[f"h{hypothesis_index}FineGrid"] = fine
                destination[f"h{hypothesis_index}CoarseGrid"] = coarse
                destination[f"h{hypothesis_index}ResidualSamples"] = residual
                restored = restore_samples(fine, residual, hypothesis)
                restoration_failures += int(np.count_nonzero(restored != samples))
                absolute_residuals.append(np.abs(residual))
            if absolute_residuals:
                track_residual_p95.append(
                    float(np.percentile(np.concatenate(absolute_residuals), 95))
                )
            top_bpms.append(top.bpm)
            top_meters.append(top.beats_per_bar)
            top_confidences.append(top.confidence)
            if not top.qualified:
                ambiguous_tracks += 1
            if len(hypotheses) >= 2:
                multiple_hypothesis_tracks += 1
            elif not top.qualified:
                unqualified_single_hypothesis_tracks += 1
            if top.loop_phase_error_fine_steps is not None:
                loop_errors.append(top.loop_phase_error_fine_steps)
                if top.qualified:
                    qualified_loop_errors.append(top.loop_phase_error_fine_steps)
            tempo_family_counts.append(_tempo_family_count(hypotheses))
            half = _octave_alternative(hypotheses, top.bpm / 2)
            double = _octave_alternative(hypotheses, top.bpm * 2)
            if any(
                alternative is not None
                and top.score - alternative.score <= 0.05
                for alternative in (half, double)
            ):
                octave_alternative_tracks += 1
            if top.bpm >= 180:
                fast_top_tracks += 1
                if half is not None and top.score > half.score + 0.01:
                    fast_with_weaker_half += 1
                    fast_retained_when_half_weaker += 1
            soundtrack = soundtrack_rows.setdefault(
                track["soundtrack"],
                {
                    "tracks": 0,
                    "topBpm": [],
                    "legacyBpm": [],
                    "ambiguous": 0,
                    "halfLegacy": 0,
                    "sameLegacy": 0,
                    "doubleLegacy": 0,
                    "otherLegacyRatio": 0,
                },
            )
            soundtrack["tracks"] += 1
            soundtrack["topBpm"].append(top.bpm)
            soundtrack["legacyBpm"].append(track["bpm"])
            soundtrack["ambiguous"] += int(not top.qualified)
            ratio = top.bpm / max(1, track["bpm"])
            if 0.45 <= ratio <= 0.55:
                soundtrack["halfLegacy"] += 1
            elif 0.9 <= ratio <= 1.1:
                soundtrack["sameLegacy"] += 1
            elif 1.8 <= ratio <= 2.2:
                soundtrack["doubleLegacy"] += 1
            else:
                soundtrack["otherLegacyRatio"] += 1
            if (track_index + 1) % 100 == 0 or track_index + 1 == len(tracks):
                print(
                    f"[timing {track_index + 1}/{len(tracks)}] "
                    f"events={end} ambiguous={ambiguous_tracks}",
                    flush=True,
                )
    if tracks:
        del destination, rows, samples, hypotheses, absolute_residuals
    timing_events.flush()
    _close_memmap(timing_events)
    del timing_events
    _close_memmap(exact_events)
    del exact_events
    partial_events.replace(final_events)
    hypotheses_partial.replace(hypotheses_final)
    np.save(output / "timing-offsets.npy", offset_values.astype("<i8", copy=False))
    soundtrack_audit = {
        name: {
            **{key: value for key, value in row.items() if not isinstance(value, list)},
            "topBpm": _quantiles(row["topBpm"]),
            "legacyBpm": _quantiles(row["legacyBpm"]),
        }
        for name, row in sorted(soundtrack_rows.items())
    }
    audit = {
        "schema": "chiptunes-gameboy-dual-clock-audit-v1",
        "sourceDatasetFingerprint": source_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "events": event_count,
        "hypothesesPerTrack": hypotheses_per_track,
        "tracksWithMultipleHypotheses": multiple_hypothesis_tracks,
        "minimumDistinctTempoFamilies": min(tempo_family_counts, default=0),
        "tracksWithAtLeastTwoTempoFamilies": sum(
            count >= 2 for count in tempo_family_counts
        ),
        "unqualifiedSingleHypothesisTracks": unqualified_single_hypothesis_tracks,
        "ambiguousTracks": ambiguous_tracks,
        "qualifiedTracks": len(tracks) - ambiguous_tracks,
        "restorationFailures": restoration_failures,
        "topBpm": _quantiles(top_bpms),
        "topMeterCounts": {
            str(meter): int(top_meters.count(meter))
            for meter in METERS
        },
        "topConfidence": _quantiles(top_confidences),
        "loopPhaseErrorFineSteps": _quantiles(loop_errors),
        "qualifiedLoopPhaseErrorFineSteps": _quantiles(qualified_loop_errors),
        "qualifiedLoopPhaseOutliers": sum(
            error > 2.0 for error in qualified_loop_errors
        ),
        "trackResidualP95Samples": _quantiles(track_residual_p95),
        "tempoOctaveAudit": {
            "tracksWithCloseHalfOrDoubleAlternative": octave_alternative_tracks,
            "fastTopTracks": fast_top_tracks,
            "fastTracksWithWeakerHalfTime": fast_with_weaker_half,
            "fastRetainedWhenHalfTimeWeaker": fast_retained_when_half_weaker,
            "bySoundtrack": soundtrack_audit,
        },
    }
    audit["passed"] = (
        restoration_failures == 0
        and multiple_hypothesis_tracks == len(tracks)
        and all(count >= 2 for count in tempo_family_counts)
        and unqualified_single_hypothesis_tracks == 0
        and not any(error > 2.0 for error in qualified_loop_errors)
        and all(BPM_MIN <= bpm <= BPM_MAX for bpm in top_bpms)
    )
    (output / "timing-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    manifest = {
        "schema": "chiptunes-gameboy-dual-clock-dataset-v1",
        "sourceDataset": str(dataset),
        "sourceDatasetFingerprint": source_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "events": event_count,
        "sampleRate": SAMPLE_RATE,
        "bpmSearch": {
            "minimum": BPM_MIN,
            "maximum": BPM_MAX,
            "step": BPM_STEP,
        },
        "meters": list(METERS),
        "hypothesesPerTrack": hypotheses_per_track,
        "coarseSlotsPerBar": 32,
        "fineSlotsPerBar": 128,
        "timingEventDtype": timing_event_dtype(hypotheses_per_track).descr,
        "timingEventsSha256": _sha256_file(final_events),
        "timingHypothesesSha256": _sha256_file(hypotheses_final),
        "timingOffsetsSha256": _sha256_file(output / "timing-offsets.npy"),
        "auditPassed": audit["passed"],
    }
    manifest["contentFingerprint"] = hashlib.sha256(
        (
            manifest["sourceDatasetFingerprint"]
            + manifest["timingEventsSha256"]
            + manifest["timingHypothesesSha256"]
            + manifest["timingOffsetsSha256"]
        ).encode()
    ).hexdigest()
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({**manifest, "audit": audit}, indent=2), flush=True)
    if not audit["passed"]:
        raise RuntimeError("dual-clock timing audit failed")
    return manifest
