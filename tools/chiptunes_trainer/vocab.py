from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.cluster.vq import kmeans2


def _group(patch: dict) -> str:
    return f"{patch.get('system', 'none')}:{patch.get('type', 'none')}"


def _vector(patch: dict) -> np.ndarray:
    system = 1.0 if patch.get("system") == "gameboy" else 0.0
    kind = patch.get("type")
    envelope, sweep = patch.get("envelope", {}), patch.get("sweep", {})
    if kind == "wave":
        table = np.asarray(patch.get("table", [0] * 32), dtype=np.float64)
        table -= table.mean()
        peak = np.max(np.abs(table))
        if peak:
            table /= peak
        return np.concatenate((table, [patch.get("level", 1)]))
    if kind == "pulse":
        return np.asarray(
            [
                system,
                patch.get("duty", 0.5),
                envelope.get("initial", 0.5),
                envelope.get("rate", 0) / 15,
                bool(envelope.get("constant")),
                bool(envelope.get("loop")),
                1 if envelope.get("direction") == "up" else 0,
                sweep.get("period", 0) / 7,
                sweep.get("shift", 0) / 7,
                1 if sweep.get("direction") == "down" else 0,
                bool(sweep.get("enabled", True)),
            ],
            dtype=np.float64,
        )
    if kind == "noise":
        return np.asarray(
            [
                system,
                1 if patch.get("mode") == 7 else 0,
                patch.get("period", 0) / 15,
                patch.get("clockShift", 0) / 15,
                envelope.get("initial", 0.5),
                envelope.get("rate", 0) / 15,
                bool(envelope.get("constant")),
                bool(envelope.get("loop")),
                1 if envelope.get("direction") == "up" else 0,
            ],
            dtype=np.float64,
        )
    return np.zeros(2, dtype=np.float64)


def cluster_patch_vocabulary(dataset_dir: Path, seed: int = 0xC41F7) -> dict:
    manifest_path = dataset_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("patchVocabulary", {}).get("clustered"):
        return manifest
    features = np.load(dataset_dir / "features.npy", mmap_mode="r")
    offsets = np.load(dataset_dir / "offsets.npy", mmap_mode="r")
    tracks = json.loads((dataset_dir / "tracks.json").read_text())
    patches = json.loads((dataset_dir / "patches.json").read_text())
    train_counts = Counter()
    for index, track in enumerate(tracks):
        if track["split"] != "train":
            continue
        ids, counts = np.unique(features[int(offsets[index]) : int(offsets[index + 1]), 6], return_counts=True)
        train_counts.update(dict(zip(ids.tolist(), counts.tolist())))
    grouped: dict[str, list[int]] = defaultdict(list)
    for patch_id, patch in enumerate(patches):
        if patch_id and patch:
            grouped[_group(patch)].append(patch_id)
    targets = {
        "gameboy:wave": 128,
        "gameboy:pulse": 64,
        "nes:pulse": 64,
        "gameboy:noise": 32,
        "nes:noise": 32,
        "nes:triangle": 1,
    }
    rng = np.random.default_rng(seed)
    cluster_rows = [{"id": 0, "group": "none:none", "representative": {"type": "none"}, "trainingOccurrences": 0}]
    mapping = np.zeros(len(patches), dtype=np.int32)
    for group in sorted(grouped):
        ids = grouped[group]
        train_ids = [patch_id for patch_id in ids if train_counts[patch_id] > 0] or ids
        vectors = np.stack([_vector(patches[patch_id]) for patch_id in train_ids])
        requested = targets.get(group, min(32, len(train_ids)))
        count = max(1, min(requested, len(train_ids)))
        weighted_indices = []
        for local_index, patch_id in enumerate(train_ids):
            repeats = min(16, 1 + int(math.log2(1 + train_counts[patch_id])))
            weighted_indices.extend([local_index] * repeats)
        training = vectors[np.asarray(weighted_indices, dtype=np.int64)]
        if count == 1:
            centroids = np.mean(training, axis=0, keepdims=True)
        else:
            centroids, _ = kmeans2(training, count, iter=40, minit="++", seed=rng)
        all_vectors = np.stack([_vector(patches[patch_id]) for patch_id in ids])
        distances = ((all_vectors[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        assignments = distances.argmin(axis=1)
        for cluster_index in range(len(centroids)):
            members = np.where(assignments == cluster_index)[0]
            if not len(members):
                continue
            representative_local = members[np.argmin(distances[members, cluster_index])]
            representative_id = ids[int(representative_local)]
            runtime_id = len(cluster_rows)
            occurrence_count = sum(train_counts[ids[int(member)]] for member in members)
            cluster_rows.append(
                {
                    "id": runtime_id,
                    "group": group,
                    "representative": patches[representative_id],
                    "trainingOccurrences": occurrence_count,
                    "sourcePatchCount": len(members),
                }
            )
            for member in members:
                mapping[ids[int(member)]] = runtime_id
    temporary = dataset_dir / "features.clustered.npy"
    output = np.lib.format.open_memmap(temporary, mode="w+", dtype=features.dtype, shape=features.shape)
    chunk = 500_000
    for start in range(0, len(features), chunk):
        block = np.asarray(features[start : start + chunk]).copy()
        block[:, 6] = mapping[block[:, 6]]
        output[start : start + len(block)] = block
    output.flush()
    del output, features
    (dataset_dir / "patches-exact.json").write_text(json.dumps(patches, separators=(",", ":")) + "\n")
    (dataset_dir / "patches.json").write_text(json.dumps([row["representative"] for row in cluster_rows], separators=(",", ":")) + "\n")
    (dataset_dir / "patch-clusters.json").write_text(json.dumps(cluster_rows, indent=2) + "\n")
    temporary.replace(dataset_dir / "features.npy")
    manifest["patchVocabulary"] = {
        "clustered": True,
        "exactPatches": len(patches) - 1,
        "clusters": len(cluster_rows) - 1,
        "groups": dict(Counter(row["group"] for row in cluster_rows[1:])),
        "fitOn": "training split only",
    }
    manifest["patches"] = len(cluster_rows) - 1
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
