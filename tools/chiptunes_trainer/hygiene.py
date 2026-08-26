from __future__ import annotations

import hashlib
import itertools
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


SKETCH_SIZE = 64
MAX_PROBE_DOCUMENT_FREQUENCY = 64
MINIMUM_SHARED_SHINGLES = 16
NEAR_DUPLICATE_JACCARD = 0.62
NEAR_DUPLICATE_CONTAINMENT = 0.82
SUPPORTED_PHRASE_JACCARD = 0.48
SUPPORTED_PHRASE_CONTAINMENT = 0.70
MINIMUM_SHARED_STATE_SHINGLES = 6
STATE_SUPPORT_CONTAINMENT = 0.65
CHANNEL_SHINGLE_EVENTS = (5, 9)
ENSEMBLE_SHINGLE_ONSETS = (6, 12)
STATE_SHINGLE_EVENTS = (2, 4)
GAMEBOY_REGISTER_COUNT = 0x30
GAMEBOY_KNOWN_MASK_BYTES = GAMEBOY_REGISTER_COUNT // 8
STATE_REGISTER_FIELDS = {
    # Frequency and trigger bits are deliberately removed. These fields retain
    # raw hardware timbre/performance state without using learned patch IDs.
    0: ((0x00, 0xFF), (0x01, 0xC0), (0x02, 0xFF), (0x04, 0x40)),
    1: ((0x06, 0xC0), (0x07, 0xFF), (0x09, 0x40)),
    2: (
        (0x0A, 0x80),
        (0x0C, 0x60),
        (0x0E, 0x40),
        *((address, 0xFF) for address in range(0x20, 0x30)),
    ),
    3: ((0x11, 0xFF), (0x12, 0xFF), (0x13, 0x40)),
}


class UnionFind:
    def __init__(self, size: int):
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, value: int) -> int:
        root = value
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[value] != value:
            parent = self.parent[value]
            self.parent[value] = root
            value = parent
        return root

    def union(self, left: int, right: int) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


def soundtrack_family_key(soundtrack: str) -> str:
    value = soundtrack.casefold()
    value = re.sub(
        r"(?:(?:__|_)(?:nintendo_)?game_boy(?:_+color)?)+$",
        "",
        value,
    )
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def _hash_rows(values: np.ndarray, seed: int) -> np.ndarray:
    values = np.asarray(values, dtype=np.int64)
    if not len(values):
        return np.empty(0, dtype=np.uint64)
    result = np.full(
        len(values),
        np.uint64(0xCBF29CE484222325 ^ seed),
        dtype=np.uint64,
    )
    with np.errstate(over="ignore"):
        for column in range(values.shape[1]):
            encoded = values[:, column].astype(np.uint64, copy=False)
            result ^= encoded + np.uint64(0x9E3779B97F4A7C15 + column)
            result *= np.uint64(0x100000001B3)
            result ^= result >> np.uint64(29)
    return result


def _ratio_rows(samples: np.ndarray, width: int) -> tuple[np.ndarray, np.ndarray]:
    windows = np.lib.stride_tricks.sliding_window_view(samples, width)
    deltas = np.diff(windows, axis=1)
    totals = deltas.sum(axis=1)
    valid = totals > 0
    ratios = np.zeros_like(deltas, dtype=np.int64)
    ratios[valid] = np.rint(
        deltas[valid] / totals[valid, None] * 64
    ).astype(np.int64)
    return ratios, valid


def phrase_shingles(exact_events: np.ndarray) -> np.ndarray:
    """Return transposition- and tempo-scale-normalized composition shingles."""

    rows = np.asarray(exact_events, dtype=np.int64)
    if not len(rows):
        return np.empty(0, dtype=np.uint64)
    hashes = []
    for channel in range(4):
        lane = rows[rows[:, 1] == channel]
        for width in CHANNEL_SHINGLE_EVENTS:
            if len(lane) < width:
                continue
            ratios, valid = _ratio_rows(lane[:, 0], width)
            pitch_windows = np.lib.stride_tricks.sliding_window_view(
                lane[:, 2],
                width,
            )
            if channel == 3:
                intervals = np.zeros_like(ratios)
            else:
                intervals = np.clip(
                    np.rint(np.diff(pitch_windows, axis=1) / 100),
                    -48,
                    48,
                ).astype(np.int64)
            values = np.column_stack(
                (
                    np.full(len(ratios), channel, dtype=np.int64),
                    ratios,
                    intervals,
                )
            )
            hashes.append(
                _hash_rows(values[valid], 0x100 + channel * 16 + width)
            )
    samples = rows[:, 0]
    channels = rows[:, 1]
    unique_samples, starts = np.unique(samples, return_index=True)
    channel_masks = np.bitwise_or.reduceat(
        np.left_shift(np.int64(1), channels),
        starts,
    )
    for width in ENSEMBLE_SHINGLE_ONSETS:
        if len(unique_samples) < width:
            continue
        ratios, valid = _ratio_rows(unique_samples, width)
        mask_windows = np.lib.stride_tricks.sliding_window_view(
            channel_masks,
            width,
        )
        ensemble_values = np.column_stack((ratios, mask_windows))
        hashes.append(_hash_rows(ensemble_values[valid], 0x200 + width))
    if not hashes:
        return np.empty(0, dtype=np.uint64)
    return np.unique(np.concatenate(hashes))


def _known_register(states: np.ndarray, address: int) -> np.ndarray:
    mask_column = GAMEBOY_REGISTER_COUNT + address // 8
    return (states[:, mask_column] >> (address % 8)) & 1


def register_state_shingles(
    exact_events: np.ndarray,
    trigger_states: np.ndarray,
) -> np.ndarray:
    """Fingerprint raw Game Boy timbre state while ignoring note frequency."""

    rows = np.asarray(exact_events, dtype=np.int64)
    states = np.asarray(trigger_states, dtype=np.uint8)
    if len(rows) != len(states):
        raise ValueError("trigger-state rows must align one-to-one with events")
    if states.ndim != 2 or states.shape[1] != (
        GAMEBOY_REGISTER_COUNT + GAMEBOY_KNOWN_MASK_BYTES
    ):
        raise ValueError("unexpected Game Boy trigger-state shape")
    hashes = []
    for channel, register_fields in STATE_REGISTER_FIELDS.items():
        lane_mask = rows[:, 1] == channel
        lane_states = states[lane_mask]
        columns = [np.full(len(lane_states), channel, dtype=np.int64)]
        for address, value_mask in register_fields:
            columns.extend(
                (
                    _known_register(lane_states, address).astype(np.int64),
                    (lane_states[:, address] & value_mask).astype(np.int64),
                )
            )
        signatures = np.column_stack(columns)
        for width in STATE_SHINGLE_EVENTS:
            if len(lane_states) < width:
                continue
            windows = np.lib.stride_tricks.sliding_window_view(
                signatures,
                width,
                axis=0,
            )
            flattened = windows.reshape(len(windows), -1)
            hashes.append(
                _hash_rows(
                    flattened,
                    0x300 + channel * 16 + width,
                )
            )
    if not hashes:
        return np.empty(0, dtype=np.uint64)
    return np.unique(np.concatenate(hashes))


def shingle_similarity(left: np.ndarray, right: np.ndarray) -> dict:
    intersection = int(
        len(np.intersect1d(left, right, assume_unique=True))
    )
    union = len(left) + len(right) - intersection
    minimum = min(len(left), len(right))
    return {
        "intersection": intersection,
        "jaccard": intersection / union if union else 1.0,
        "containment": intersection / minimum if minimum else 0.0,
    }


def _register_hash(rows: np.ndarray) -> str:
    values = np.asarray(rows, dtype="<i8")
    return hashlib.sha256(values.tobytes(order="C")).hexdigest()


def _shingle_hash(shingles: np.ndarray) -> str:
    return hashlib.sha256(
        np.asarray(shingles, dtype="<u8").tobytes(order="C")
    ).hexdigest()


def _sketch(shingles: np.ndarray) -> np.ndarray:
    if len(shingles) <= SKETCH_SIZE:
        return np.asarray(shingles, dtype=np.uint64)
    return np.partition(shingles, SKETCH_SIZE - 1)[:SKETCH_SIZE]


def _close_memmap(array) -> None:
    memory_map = getattr(array, "_mmap", None)
    if memory_map is not None:
        memory_map.close()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _component_split(component_id: str) -> str:
    value = int(hashlib.sha256(component_id.encode()).hexdigest()[:8], 16) % 100
    return "train" if value < 80 else "validation" if value < 90 else "test"


def _asymmetric_probe_hits(
    shingles: list[np.ndarray],
    sketches: list[np.ndarray],
) -> tuple[dict[tuple[int, int], list[int]], dict, list[int]]:
    """Find containment candidates even when only the short side is sketched.

    Comparing two bottom-k sketches has excellent recall for high Jaccard
    similarity, but it can miss a short cue embedded in a much longer medley.
    Here every full set probes the other tracks' sketches. A pair therefore
    becomes a candidate when either side's sampled phrases appear in the other
    full set.
    """

    all_owners: dict[int, list[int]] = defaultdict(list)
    for track_index, sketch in enumerate(sketches):
        for value in sketch:
            all_owners[int(value)].append(track_index)
    # Extremely common phrases are not identifying evidence and can otherwise
    # turn a single probe into every possible corpus pair.
    owners = {
        value: indices
        for value, indices in all_owners.items()
        if len(indices) <= MAX_PROBE_DOCUMENT_FREQUENCY
    }
    usable_counts = [
        sum(int(value) in owners for value in sketch)
        for sketch in sketches
    ]
    eligible_indices = [
        index
        for index, values in enumerate(shingles)
        if len(values) >= MINIMUM_SHARED_SHINGLES
    ]
    eligible_usable = [usable_counts[index] for index in eligible_indices]
    eligible_fractions = [
        usable_counts[index] / max(1, len(sketches[index]))
        for index in eligible_indices
    ]
    probe_audit = {
        "sketchSize": SKETCH_SIZE,
        "maximumProbeDocumentFrequency": MAX_PROBE_DOCUMENT_FREQUENCY,
        "uniqueSketchHashes": len(all_owners),
        "commonHashesDiscarded": sum(
            len(indices) > MAX_PROBE_DOCUMENT_FREQUENCY
            for indices in all_owners.values()
        ),
        "maximumDocumentFrequency": max(
            map(len, all_owners.values()),
            default=0,
        ),
        "thresholdEligibleTracks": len(eligible_indices),
        "eligibleTracksWithFewerThanThreeUsableProbes": sum(
            count < 3 for count in eligible_usable
        ),
        "minimumEligibleUsableProbes": min(eligible_usable, default=0),
        "minimumEligibleUsableFraction": min(
            eligible_fractions,
            default=0.0,
        ),
        "eligibleUsableProbeQuantiles": {
            str(percentile): float(
                np.percentile(eligible_usable, percentile)
            )
            for percentile in (5, 25, 50, 75, 95)
        }
        if eligible_usable
        else {},
    }
    hits: dict[tuple[int, int], list[int]] = {}
    for query_index, values in enumerate(shingles):
        query_hits: Counter = Counter()
        for value in values:
            for owner_index in owners.get(int(value), ()):
                if owner_index == query_index:
                    continue
                query_hits[owner_index] += 1
        for owner_index, count in query_hits.items():
            if count < 3:
                continue
            left, right = sorted((owner_index, query_index))
            pair_hits = hits.setdefault((left, right), [0, 0])
            owner_side = 0 if owner_index == left else 1
            pair_hits[owner_side] = count
    return hits, probe_audit, usable_counts


def _near_duplicate_pairs(
    phrase_shingle_rows: list[np.ndarray],
    phrase_sketches: list[np.ndarray],
    state_shingle_rows: list[np.ndarray],
    register_hashes: list[str],
    phrase_hashes: list[str],
) -> tuple[list[dict], dict, list[int]]:
    candidates: dict[tuple[int, int], set[str]] = defaultdict(set)
    for name, hashes in (
        ("exact-register", register_hashes),
        ("exact-normalized-phrase", phrase_hashes),
    ):
        groups: dict[str, list[int]] = defaultdict(list)
        for index, digest in enumerate(hashes):
            groups[digest].append(index)
        for indices in groups.values():
            if len(indices) > 1:
                for left, right in itertools.combinations(indices, 2):
                    candidates[(left, right)].add(name)
    probe_hits, probe_audit, usable_counts = _asymmetric_probe_hits(
        phrase_shingle_rows,
        phrase_sketches,
    )
    for pair, hits in probe_hits.items():
        if max(hits) >= 3:
            candidates[pair].add("asymmetric-bottom-k-candidate")
    result = []
    for (left, right), reasons in sorted(candidates.items()):
        phrase_similarity = shingle_similarity(
            phrase_shingle_rows[left],
            phrase_shingle_rows[right],
        )
        state_similarity = shingle_similarity(
            state_shingle_rows[left],
            state_shingle_rows[right],
        )
        strong_phrase = (
            phrase_similarity["intersection"] >= MINIMUM_SHARED_SHINGLES
            and (
                phrase_similarity["jaccard"] >= NEAR_DUPLICATE_JACCARD
                or phrase_similarity["containment"]
                >= NEAR_DUPLICATE_CONTAINMENT
            )
        )
        state_supported_phrase = (
            phrase_similarity["intersection"] >= MINIMUM_SHARED_SHINGLES
            and (
                phrase_similarity["jaccard"] >= SUPPORTED_PHRASE_JACCARD
                or phrase_similarity["containment"]
                >= SUPPORTED_PHRASE_CONTAINMENT
            )
            and state_similarity["intersection"]
            >= MINIMUM_SHARED_STATE_SHINGLES
            and state_similarity["containment"] >= STATE_SUPPORT_CONTAINMENT
        )
        exact_register = "exact-register" in reasons
        exact_phrase = "exact-normalized-phrase" in reasons
        near = (
            exact_register
            or exact_phrase
            or strong_phrase
            or state_supported_phrase
        )
        if near:
            if exact_register:
                reasons.add("near-exact-register")
            if exact_phrase:
                reasons.add("near-exact-phrase")
            if strong_phrase:
                reasons.add("near-strong-phrase")
            if state_supported_phrase:
                reasons.add("near-phrase-plus-register-state")
        hits = probe_hits.get((left, right), [0, 0])
        result.append(
            {
                "left": left,
                "right": right,
                "leftSketchHitsInRight": hits[0],
                "rightSketchHitsInLeft": hits[1],
                "phrase": phrase_similarity,
                "registerState": state_similarity,
                "nearDuplicate": near,
                "reasons": sorted(reasons),
            }
        )
    return result, probe_audit, usable_counts


def _write_json(path: Path, value) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    )


def build_corpus_hygiene(
    dataset: Path,
    timing: Path,
    output: Path,
) -> dict:
    dataset = dataset.resolve()
    timing = timing.resolve()
    output = output.resolve()
    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable hygiene output {output}")
    output.mkdir(parents=True)
    dataset_manifest = json.loads((dataset / "manifest.json").read_text())
    timing_manifest = json.loads((timing / "manifest.json").read_text())
    if (
        timing_manifest["sourceDatasetFingerprint"]
        != dataset_manifest["contentFingerprint"]
    ):
        raise RuntimeError("timing artifact does not belong to the source dataset")
    tracks = json.loads((dataset / "tracks.json").read_text())
    registers = np.load(dataset / "registers.npy", mmap_mode="r")
    register_offsets_map = np.load(
        dataset / "register-offsets.npy",
        mmap_mode="r",
    )
    exact_events = np.load(dataset / "exact-events.npy", mmap_mode="r")
    trigger_states = np.load(dataset / "trigger-states.npy", mmap_mode="r")
    event_offsets_map = np.load(
        dataset / "exact-event-offsets.npy",
        mmap_mode="r",
    )
    register_offsets = np.asarray(register_offsets_map, dtype=np.int64).copy()
    event_offsets = np.asarray(event_offsets_map, dtype=np.int64).copy()
    _close_memmap(register_offsets_map)
    _close_memmap(event_offsets_map)
    del register_offsets_map, event_offsets_map
    if (
        len(register_offsets) != len(tracks) + 1
        or len(event_offsets) != len(tracks) + 1
        or len(exact_events) != len(trigger_states)
    ):
        raise RuntimeError("source offsets do not align with tracks")
    register_hashes = []
    phrase_hashes = []
    state_hashes = []
    phrase_shingle_rows: list[np.ndarray] = []
    state_shingle_rows: list[np.ndarray] = []
    phrase_sketches: list[np.ndarray] = []
    empty_phrase_tracks = []
    empty_state_tracks = []
    for index, track in enumerate(tracks):
        register_rows = np.asarray(
            registers[
                int(register_offsets[index]) : int(register_offsets[index + 1])
            ]
        )
        event_rows = np.asarray(
            exact_events[
                int(event_offsets[index]) : int(event_offsets[index + 1])
            ]
        )
        trigger_rows = np.asarray(
            trigger_states[
                int(event_offsets[index]) : int(event_offsets[index + 1])
            ]
        )
        track_phrase_shingles = phrase_shingles(event_rows)
        track_state_shingles = register_state_shingles(
            event_rows,
            trigger_rows,
        )
        if not len(track_phrase_shingles):
            empty_phrase_tracks.append(track["source"])
        if not len(track_state_shingles):
            empty_state_tracks.append(track["source"])
        register_hashes.append(_register_hash(register_rows))
        phrase_hashes.append(_shingle_hash(track_phrase_shingles))
        state_hashes.append(_shingle_hash(track_state_shingles))
        phrase_shingle_rows.append(track_phrase_shingles)
        state_shingle_rows.append(track_state_shingles)
        phrase_sketches.append(_sketch(track_phrase_shingles))
        if (index + 1) % 100 == 0 or index + 1 == len(tracks):
            print(
                f"[hygiene-fingerprint {index + 1}/{len(tracks)}] "
                f"registerWrites={register_offsets[index + 1]} "
                f"events={event_offsets[index + 1]}",
                flush=True,
            )
    del register_rows, event_rows, trigger_rows
    _close_memmap(registers)
    _close_memmap(exact_events)
    _close_memmap(trigger_states)
    del registers, exact_events, trigger_states
    pairs, probe_audit, usable_probe_counts = _near_duplicate_pairs(
        phrase_shingle_rows,
        phrase_sketches,
        state_shingle_rows,
        register_hashes,
        phrase_hashes,
    )
    near_pairs = [pair for pair in pairs if pair["nearDuplicate"]]
    soundtracks = sorted({track["soundtrack"] for track in tracks})
    soundtrack_index = {
        soundtrack: index for index, soundtrack in enumerate(soundtracks)
    }
    union = UnionFind(len(soundtracks))
    families: dict[str, list[int]] = defaultdict(list)
    for soundtrack, index in soundtrack_index.items():
        families[soundtrack_family_key(soundtrack)].append(index)
    for indices in families.values():
        for index in indices[1:]:
            union.union(indices[0], index)
    for pair in near_pairs:
        left_soundtrack = soundtrack_index[tracks[pair["left"]]["soundtrack"]]
        right_soundtrack = soundtrack_index[tracks[pair["right"]]["soundtrack"]]
        union.union(left_soundtrack, right_soundtrack)
    component_soundtracks: dict[int, list[str]] = defaultdict(list)
    for soundtrack, index in soundtrack_index.items():
        component_soundtracks[union.find(index)].append(soundtrack)
    soundtrack_track_counts = Counter(track["soundtrack"] for track in tracks)
    component_rows = {}
    soundtrack_component = {}
    for root, members in sorted(component_soundtracks.items()):
        members.sort()
        member_set = set(members)
        component_id = hashlib.sha256("\n".join(members).encode()).hexdigest()
        split = _component_split(component_id)
        component_rows[component_id] = {
            "componentId": component_id,
            "split": split,
            "soundtracks": members,
            "tracks": sum(
                soundtrack_track_counts[soundtrack]
                for soundtrack in member_set
            ),
        }
        for soundtrack in members:
            soundtrack_component[soundtrack] = component_id
    track_rows = []
    for index, track in enumerate(tracks):
        component_id = soundtrack_component[track["soundtrack"]]
        track_rows.append(
            {
                "trackIndex": index,
                "source": track["source"],
                "soundtrack": track["soundtrack"],
                "soundtrackFamily": soundtrack_family_key(track["soundtrack"]),
                "componentId": component_id,
                "originalSplit": track["split"],
                "split": component_rows[component_id]["split"],
                "registerHash": register_hashes[index],
                "normalizedPhraseHash": phrase_hashes[index],
                "registerStateHash": state_hashes[index],
                "phraseShingles": len(phrase_shingle_rows[index]),
                "registerStateShingles": len(state_shingle_rows[index]),
                "phraseSketch": [
                    f"{int(value):016x}"
                    for value in np.sort(phrase_sketches[index])
                ],
                "usablePhraseSketchProbes": usable_probe_counts[index],
                "soundtrackBalancedWeight": 1
                / soundtrack_track_counts[track["soundtrack"]],
            }
        )
    current_cross_split = sum(
        tracks[pair["left"]]["split"] != tracks[pair["right"]]["split"]
        for pair in near_pairs
    )
    new_cross_split = sum(
        track_rows[pair["left"]]["split"]
        != track_rows[pair["right"]]["split"]
        for pair in near_pairs
    )
    exact_register_groups = Counter(register_hashes)
    exact_phrase_groups = Counter(phrase_hashes)
    exact_state_groups = Counter(state_hashes)
    exact_register_cross_split = sum(
        track_rows[pair["left"]]["split"]
        != track_rows[pair["right"]]["split"]
        for pair in near_pairs
        if "exact-register" in pair["reasons"]
    )
    exact_phrase_cross_split = sum(
        track_rows[pair["left"]]["split"]
        != track_rows[pair["right"]]["split"]
        for pair in near_pairs
        if "exact-normalized-phrase" in pair["reasons"]
    )
    soundtrack_exposure = defaultdict(float)
    for row in track_rows:
        soundtrack_exposure[row["soundtrack"]] += row[
            "soundtrackBalancedWeight"
        ]
    groups_path = output / "groups.json"
    pairs_path = output / "near-duplicates.json"
    tracks_path = output / "tracks.jsonl"
    sampler_path = output / "sampler.json"
    serialized_pairs = [
        {
            **pair,
            "leftSource": tracks[pair["left"]]["source"],
            "rightSource": tracks[pair["right"]]["source"],
            "leftSoundtrack": tracks[pair["left"]]["soundtrack"],
            "rightSoundtrack": tracks[pair["right"]]["soundtrack"],
        }
        for pair in pairs
    ]
    _write_json(groups_path, list(component_rows.values()))
    _write_json(
        pairs_path,
        {
            "thresholds": {
                "minimumSharedShingles": MINIMUM_SHARED_SHINGLES,
                "jaccard": NEAR_DUPLICATE_JACCARD,
                "containment": NEAR_DUPLICATE_CONTAINMENT,
                "supportedPhraseJaccard": SUPPORTED_PHRASE_JACCARD,
                "supportedPhraseContainment": SUPPORTED_PHRASE_CONTAINMENT,
                "minimumSharedRegisterStateShingles": (
                    MINIMUM_SHARED_STATE_SHINGLES
                ),
                "registerStateSupportContainment": STATE_SUPPORT_CONTAINMENT,
                "maximumProbeDocumentFrequency": (
                    MAX_PROBE_DOCUMENT_FREQUENCY
                ),
            },
            "candidatePairs": len(pairs),
            "nearDuplicatePairs": len(near_pairs),
            "pairs": serialized_pairs,
        },
    )
    with tracks_path.open("x", encoding="utf-8") as stream:
        for row in track_rows:
            stream.write(
                json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
            )
    sampler = {
        "schema": "chiptunes-soundtrack-balanced-sampler-v1",
        "method": (
            "sample soundtracks uniformly, sample tracks uniformly within a "
            "soundtrack, then sample a section uniformly within the track"
        ),
        "longTrackPolicy": "one section draw per selected track; duration does not add weight",
        "trackWeightField": "soundtrackBalancedWeight",
        "soundtracks": len(soundtrack_track_counts),
        "minimumTrackWeight": min(
            row["soundtrackBalancedWeight"] for row in track_rows
        ),
        "maximumTrackWeight": max(
            row["soundtrackBalancedWeight"] for row in track_rows
        ),
        "minimumSoundtrackExposure": min(soundtrack_exposure.values()),
        "maximumSoundtrackExposure": max(soundtrack_exposure.values()),
    }
    _write_json(sampler_path, sampler)
    audit = {
        "schema": "chiptunes-gameboy-corpus-hygiene-audit-v1",
        "datasetFingerprint": dataset_manifest["contentFingerprint"],
        "timingFingerprint": timing_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "soundtracks": len(soundtracks),
        "components": len(component_rows),
        "emptyPhraseTracks": len(empty_phrase_tracks),
        "emptyRegisterStateTracks": len(empty_state_tracks),
        "exactRegisterDuplicateGroups": sum(
            count > 1 for count in exact_register_groups.values()
        ),
        "exactNormalizedPhraseDuplicateGroups": sum(
            count > 1 for count in exact_phrase_groups.values()
        ),
        "exactRegisterStateDuplicateGroups": sum(
            count > 1 for count in exact_state_groups.values()
        ),
        "candidateProbe": probe_audit,
        "candidatePairs": len(pairs),
        "nearDuplicatePairs": len(near_pairs),
        "rejectedCandidatePairs": len(pairs) - len(near_pairs),
        "nearDuplicatePairsAcrossSoundtracks": sum(
            tracks[pair["left"]]["soundtrack"]
            != tracks[pair["right"]]["soundtrack"]
            for pair in near_pairs
        ),
        "nearDuplicateReasonCounts": dict(
            sorted(
                Counter(
                    reason
                    for pair in near_pairs
                    for reason in pair["reasons"]
                    if reason.startswith("near-")
                ).items()
            )
        ),
        "nearDuplicatePairsCrossingOriginalSplits": current_cross_split,
        "nearDuplicatePairsCrossingNewSplits": new_cross_split,
        "exactRegisterPairsCrossingNewSplits": exact_register_cross_split,
        "exactNormalizedPhrasePairsCrossingNewSplits": (
            exact_phrase_cross_split
        ),
        "splitTracks": {
            split: sum(row["split"] == split for row in track_rows)
            for split in ("train", "validation", "test")
        },
        "splitSoundtracks": {
            split: len(
                {
                    row["soundtrack"]
                    for row in track_rows
                    if row["split"] == split
                }
            )
            for split in ("train", "validation", "test")
        },
        "soundtrackExposure": {
            "minimum": min(soundtrack_exposure.values()),
            "maximum": max(soundtrack_exposure.values()),
            "ratio": max(soundtrack_exposure.values())
            / min(soundtrack_exposure.values()),
        },
        "componentSize": {
            "maximumSoundtracks": max(
                len(row["soundtracks"]) for row in component_rows.values()
            ),
            "maximumTracks": max(
                row["tracks"] for row in component_rows.values()
            ),
            "multiSoundtrackComponents": sum(
                len(row["soundtracks"]) > 1
                for row in component_rows.values()
            ),
        },
        "examples": {
            "emptyPhraseTracks": empty_phrase_tracks[:10],
            "emptyRegisterStateTracks": empty_state_tracks[:10],
            "originalCrossSplitPairs": [
                {
                    **pair,
                    "leftSource": tracks[pair["left"]]["source"],
                    "rightSource": tracks[pair["right"]]["source"],
                }
                for pair in near_pairs
                if tracks[pair["left"]]["split"]
                != tracks[pair["right"]]["split"]
            ][:20],
            "nearDuplicatePairs": [
                row
                for row in serialized_pairs
                if row["nearDuplicate"]
            ][:50],
        },
    }
    audit["passed"] = (
        not empty_phrase_tracks
        and new_cross_split == 0
        and exact_register_cross_split == 0
        and exact_phrase_cross_split == 0
        and probe_audit[
            "eligibleTracksWithFewerThanThreeUsableProbes"
        ]
        == 0
        and abs(audit["soundtrackExposure"]["ratio"] - 1.0) < 1e-9
        and sum(audit["splitTracks"].values()) == len(tracks)
        and all(audit["splitTracks"].values())
        and all(audit["splitSoundtracks"].values())
    )
    audit_path = output / "audit.json"
    _write_json(audit_path, audit)
    manifest = {
        "schema": "chiptunes-gameboy-corpus-hygiene-v1",
        "datasetFingerprint": dataset_manifest["contentFingerprint"],
        "timingFingerprint": timing_manifest["contentFingerprint"],
        "tracks": len(tracks),
        "soundtracks": len(soundtracks),
        "components": len(component_rows),
        "thresholds": {
            "minimumSharedShingles": MINIMUM_SHARED_SHINGLES,
            "jaccard": NEAR_DUPLICATE_JACCARD,
            "containment": NEAR_DUPLICATE_CONTAINMENT,
            "supportedPhraseJaccard": SUPPORTED_PHRASE_JACCARD,
            "supportedPhraseContainment": SUPPORTED_PHRASE_CONTAINMENT,
            "minimumSharedRegisterStateShingles": (
                MINIMUM_SHARED_STATE_SHINGLES
            ),
            "registerStateSupportContainment": STATE_SUPPORT_CONTAINMENT,
            "maximumProbeDocumentFrequency": (
                MAX_PROBE_DOCUMENT_FREQUENCY
            ),
        },
        "tracksSha256": _sha256_file(tracks_path),
        "groupsSha256": _sha256_file(groups_path),
        "nearDuplicatesSha256": _sha256_file(pairs_path),
        "samplerSha256": _sha256_file(sampler_path),
        "auditSha256": _sha256_file(audit_path),
        "auditPassed": audit["passed"],
    }
    manifest["contentFingerprint"] = hashlib.sha256(
        "".join(
            (
                manifest["datasetFingerprint"],
                manifest["timingFingerprint"],
                manifest["tracksSha256"],
                manifest["groupsSha256"],
                manifest["nearDuplicatesSha256"],
                manifest["samplerSha256"],
                manifest["auditSha256"],
            )
        ).encode()
    ).hexdigest()
    _write_json(output / "manifest.json", manifest)
    print(json.dumps({"manifest": manifest, "audit": audit}, indent=2), flush=True)
    if not audit["passed"]:
        raise RuntimeError("corpus hygiene audit failed")
    return manifest
