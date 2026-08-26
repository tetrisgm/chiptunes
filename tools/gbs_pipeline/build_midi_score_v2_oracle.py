"""Build the blinded 30-pair score-v2 preservation listening oracle.

``stage`` runs beside a completed corpus build and selects six structurally
stressful files in each of five strata. It copies the original MIDI and writes
a canonical reconstruction into a compact transfer directory.

``render`` runs on the Mac. It renders both sides through the same pinned
Apple-DLS binary/bank, converts PCM to lossless FLAC, randomizes A/B sides, adds
hidden repeats, and emits the existing localhost comparison page contract.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Sequence

import compare_page
from midi_score_v2 import read_score
from render_score_v2 import verified_score_to_smf


SCHEMA = "chiptunes-midi-score-v2-oracle-v1"
STRATA = ("dense", "drum-heavy", "tempo-changing", "sustain-heavy", "general")
STABLE_RENDERER_FIELDS = (
    "channels", "frames", "renderedMusicalSeconds", "sampleRate",
    "sourceSeconds", "tailSeconds",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _portable_stage_path(stage: Path, relative: str) -> Path:
    """Resolve a relative stage path written on Windows or POSIX."""
    portable = PurePosixPath(relative.replace("\\", "/"))
    if portable.is_absolute() or ".." in portable.parts \
            or any(":" in part for part in portable.parts):
        raise ValueError(f"unsafe staged path {relative!r}")
    return stage.joinpath(*portable.parts)


def _stable_renderer_receipt(receipt: dict[str, Any]) -> dict[str, Any]:
    return {key: receipt[key] for key in STABLE_RENDERER_FIELDS}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _families(path: Path) -> dict[str, str]:
    return {row["relativePath"]: row["family"] for row in _read_jsonl(path)}


def _structural(row: dict[str, Any]) -> dict[str, Any]:
    statistics = row["scoreStatistics"]
    notes = statistics["notes"]
    duration = max(1, row["compound"]["duration96"])
    return {
        "notes": notes,
        "parts": statistics["parts"],
        "maxPolyphony": statistics["maxPolyphony"],
        "drumNotes": statistics["drumNotes"],
        "drumShare": statistics["drumNotes"] / notes if notes else 0.0,
        "notesPerQuarter": notes * 96 / duration,
        "duration96": duration,
        "tempoChanges": row["scoreCounts"]["tempos"],
        "controls": row["scoreCounts"]["controls"],
        "pitchBends": row["scoreCounts"]["pitchBends"],
    }


def _rank_pick(candidates: Sequence[dict[str, Any]], count: int,
               used_families: set[str], category: str,
               score: Callable[[dict[str, Any]], tuple[Any, ...]]) \
        -> list[dict[str, Any]]:
    selected = []
    for row in sorted(candidates, key=lambda item: (
            score(item), item["relativePath"]), reverse=True):
        if row["family"] in used_families:
            continue
        chosen = dict(row)
        chosen["category"] = category
        selected.append(chosen)
        used_families.add(row["family"])
        if len(selected) == count:
            return selected
    raise ValueError(f"only found {len(selected)}/{count} family-unique {category} files")


def select_rows(rows: Sequence[dict[str, Any]], families: dict[str, str],
                score_loader: Callable[[dict[str, Any]], dict[str, Any]],
                per_category: int = 6, seed: int = 20260815
                ) -> list[dict[str, Any]]:
    eligible = []
    for source in rows:
        if source.get("status") != "kept":
            continue
        row = dict(source)
        row["family"] = families[row["relativePath"]]
        row["structural"] = _structural(row)
        eligible.append(row)
    if len(eligible) < per_category * len(STRATA):
        raise ValueError("not enough kept scores for the oracle")
    used: set[str] = set()
    selected = []
    selected += _rank_pick(
        eligible, per_category, used, "dense",
        lambda row: (row["structural"]["maxPolyphony"],
                     row["structural"]["parts"],
                     row["structural"]["notesPerQuarter"],
                     row["structural"]["notes"]))
    selected += _rank_pick(
        [row for row in eligible if row["structural"]["drumNotes"]],
        per_category, used, "drum-heavy",
        lambda row: (row["structural"]["drumShare"],
                     row["structural"]["drumNotes"],
                     row["structural"]["notesPerQuarter"]))
    selected += _rank_pick(
        [row for row in eligible if row["structural"]["tempoChanges"] >= 2],
        per_category, used, "tempo-changing",
        lambda row: (row["structural"]["tempoChanges"],
                     row["structural"]["duration96"],
                     row["structural"]["notes"]))

    # Opening every score is expensive. Controls are a lossless shortlist, not
    # the sustain ranking itself; the final ranking reads and counts CC64 plus
    # notes whose sounding end exceeds their key release.
    control_candidates = sorted(
        (row for row in eligible if row["family"] not in used
         and row["structural"]["controls"]),
        key=lambda row: (row["structural"]["controls"], row["relativePath"]),
        reverse=True)[:2000]
    sustain_rows = []
    for row in control_candidates:
        score_value = score_loader(row)
        structural = dict(row["structural"])
        structural["sustainControls"] = sum(
            event["controller"] == 64 for event in score_value["controls"])
        structural["sustainedNotes"] = sum(
            note["end"] > note["keyEnd"] for note in score_value["notes"])
        if structural["sustainControls"] or structural["sustainedNotes"]:
            enriched = dict(row)
            enriched["structural"] = structural
            sustain_rows.append(enriched)
    selected += _rank_pick(
        sustain_rows, per_category, used, "sustain-heavy",
        lambda row: (row["structural"]["sustainedNotes"],
                     row["structural"]["sustainControls"],
                     row["structural"]["duration96"]))

    remaining = [row for row in eligible if row["family"] not in used]
    remaining.sort(key=lambda row: (
        row["structural"]["duration96"], row["relativePath"]))
    general = []
    for index in range(per_category):
        target = round((index + 1) * (len(remaining) - 1) / (per_category + 1))
        order = sorted(range(len(remaining)), key=lambda candidate: (
            abs(candidate - target),
            hashlib.sha256(f"{seed}:{remaining[candidate]['relativePath']}".encode())
            .hexdigest()))
        choice = next((remaining[candidate] for candidate in order
                       if remaining[candidate]["family"] not in used), None)
        if choice is None:
            raise ValueError("not enough family-unique general files")
        selected_row = dict(choice)
        selected_row["category"] = "general"
        selected.append(selected_row)
        general.append(selected_row)
        used.add(choice["family"])
    if collections.Counter(row["category"] for row in selected) != {
            category: per_category for category in STRATA}:
        raise AssertionError("oracle strata do not reconcile")
    return selected


def stage_oracle(build: Path, source_root: Path, output: Path,
                 per_category: int = 6, seed: int = 20260815) -> dict[str, Any]:
    receipt_path = build / "receipt.json"
    if not receipt_path.is_file():
        raise ValueError("corpus build has no complete receipt")
    build_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if build_receipt.get("status") != "complete" \
            or not build_receipt.get("machineGate", {}).get("passed"):
        raise ValueError("corpus build machine gate has not passed")
    rows = _read_jsonl(build / "manifest.jsonl")
    families = _families(build / "families.jsonl")

    def load(row: dict[str, Any]) -> dict[str, Any]:
        return read_score(build / row["scorePath"])

    selected = select_rows(rows, families, load, per_category, seed)
    output.mkdir(parents=True, exist_ok=False)
    midi_dir = output / "midi"
    midi_dir.mkdir()
    staged = []
    for index, row in enumerate(selected, 1):
        song = f"song-{index:03d}"
        original = midi_dir / f"{song}-original.mid"
        roundtrip = midi_dir / f"{song}-roundtrip.mid"
        source_path = source_root / Path(row["relativePath"])
        if not source_path.is_file():
            raise ValueError(f"missing selected source {source_path}")
        shutil.copyfile(source_path, original)
        score = load(row)
        payload, reparsed = verified_score_to_smf(score)
        roundtrip.write_bytes(payload)
        if reparsed["canonicalScoreSha256"] != row["canonicalScoreSha256"]:
            raise AssertionError("staged roundtrip changed canonical score")
        staged.append({
            "song": song,
            "category": row["category"],
            "relativePath": row["relativePath"],
            "family": row["family"],
            "canonicalScoreSha256": row["canonicalScoreSha256"],
            "structural": row["structural"],
            "original": str(original.relative_to(output)),
            "roundtrip": str(roundtrip.relative_to(output)),
            "originalSha256": _sha256(original),
            "roundtripSha256": _sha256(roundtrip),
        })
    selection = {
        "schema": SCHEMA,
        "seed": seed,
        "perCategory": per_category,
        "buildReceiptSha256": _sha256(receipt_path),
        "manifestSha256": _sha256(build / "manifest.jsonl"),
        "familiesSha256": _sha256(build / "families.jsonl"),
        "songs": staged,
    }
    selection_path = output / "selection.json"
    selection_path.write_text(json.dumps(selection, indent=2, sort_keys=True) + "\n")
    result = {
        "schema": "chiptunes-midi-score-v2-oracle-stage-v1",
        "songs": len(staged),
        "categories": dict(sorted(collections.Counter(
            row["category"] for row in staged).items())),
        "uniqueFamilies": len({row["family"] for row in staged}),
        "canonicalRoundtripPassed": len(staged),
        "selectionSha256": _sha256(selection_path),
    }
    (output / "stage-receipt.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def _render_one(renderer: Path, ffmpeg: str, midi: Path, flac: Path,
                seconds: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as directory:
        wav = Path(directory) / "render.wav"
        rendered = subprocess.run(
            [str(renderer), str(midi), str(wav), str(seconds)],
            capture_output=True, text=True, timeout=600)
        if rendered.returncode != 0 or not wav.is_file():
            raise RuntimeError(
                f"DLS render failed for {midi}: {rendered.stderr[-1000:]}")
        converted = subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", str(wav),
             "-compression_level", "12", str(flac)],
            capture_output=True, text=True, timeout=600)
        if converted.returncode != 0 or not flac.is_file() \
                or flac.stat().st_size < 4096:
            raise RuntimeError(
                f"FLAC conversion failed for {midi}: {converted.stderr[-1000:]}")
        renderer_receipt = json.loads(rendered.stdout.strip().splitlines()[-1])
        return {
            "renderer": _stable_renderer_receipt(renderer_receipt),
            "wavSha256": _sha256(wav),
            "flacSha256": _sha256(flac),
            "flacBytes": flac.stat().st_size,
        }


def make_instances(songs: Sequence[dict[str, Any]], repeat_count: int,
                   seed: int) -> list[dict[str, Any]]:
    if repeat_count > len(songs):
        raise ValueError("repeat count exceeds unique songs")
    rng = random.Random(seed)
    instances = [{"song": row["song"], "repeat": False,
                  "sideA": rng.choice(("original", "roundtrip"))}
                 for row in songs]
    for row in rng.sample(list(songs), repeat_count):
        instances.append({"song": row["song"], "repeat": True,
                          "sideA": rng.choice(("original", "roundtrip"))})
    rng.shuffle(instances)
    originals: dict[str, str] = {}
    for index, instance in enumerate(instances, 1):
        instance["id"] = f"pair-{index:03d}"
        if not instance["repeat"]:
            originals[instance["song"]] = instance["id"]
    for instance in instances:
        instance["repeatOf"] = originals[instance["song"]] \
            if instance["repeat"] else None
    return instances


def render_oracle(stage: Path, output: Path, renderer: Path, sound_bank: Path,
                  ffmpeg: str = "ffmpeg", seconds: int = 60,
                  repeats: int = 6, seed: int = 20260815) -> dict[str, Any]:
    selection_path = stage / "selection.json"
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    songs = selection["songs"]
    if len(songs) != 30:
        raise ValueError(f"final Gate-A oracle requires 30 songs, got {len(songs)}")
    output.mkdir(parents=True, exist_ok=False)
    rendered: dict[str, dict[str, Any]] = {}
    for row in songs:
        song_result = {}
        for arm in ("original", "roundtrip"):
            destination = output / f"{row['song']}-{arm}.source.flac"
            song_result[arm] = _render_one(
                renderer, ffmpeg, _portable_stage_path(stage, row[arm]),
                destination, seconds)
            song_result[arm]["file"] = destination.name
        song_result["audioBitIdentical"] = (
            song_result["original"]["wavSha256"]
            == song_result["roundtrip"]["wavSha256"])
        rendered[row["song"]] = song_result

    instances = make_instances(songs, repeats, seed)
    pairs = []
    key = {}
    songs_by_id = {row["song"]: row for row in songs}
    for instance in instances:
        pair_id = instance["id"]
        side_a = instance["sideA"]
        side_b = "roundtrip" if side_a == "original" else "original"
        a_path = output / f"{pair_id}-a.flac"
        b_path = output / f"{pair_id}-b.flac"
        shutil.copyfile(
            output / rendered[instance["song"]][side_a]["file"], a_path)
        shutil.copyfile(
            output / rendered[instance["song"]][side_b]["file"], b_path)
        pairs.append({
            "id": pair_id, "song": instance["song"],
            "a": str(a_path), "b": str(b_path),
            "aLabel": side_a, "bLabel": side_b,
        })
        source = songs_by_id[instance["song"]]
        key[pair_id] = {
            "song": instance["song"], "a": side_a, "b": side_b,
            "repeat": instance["repeat"], "repeatOf": instance["repeatOf"],
            "category": source["category"],
            "relativePath": source["relativePath"],
        }
    (output / "pairs.json").write_text(
        json.dumps(pairs, indent=2, sort_keys=True) + "\n")
    (output / "key.json").write_text(
        json.dumps(key, indent=2, sort_keys=True) + "\n")
    (output / "index.html").write_text(
        compare_page.build(pairs, output.name, "serve"), encoding="utf-8")
    receipt = {
        "schema": "chiptunes-midi-score-v2-oracle-render-v1",
        "selectionSha256": _sha256(selection_path),
        "rendererSha256": _sha256(renderer),
        "soundBankSha256": _sha256(sound_bank),
        "seconds": seconds,
        "tailSeconds": 2,
        "codec": "FLAC",
        "uniqueSongs": len(songs),
        "hiddenRepeats": repeats,
        "reviewPairs": len(pairs),
        "audioBitIdenticalPairs": sum(
            value["audioBitIdentical"] for value in rendered.values()),
        "rendered": rendered,
        "pairsSha256": _sha256(output / "pairs.json"),
        "keySha256": _sha256(output / "key.json"),
    }
    (output / "receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return {key: value for key, value in receipt.items() if key != "rendered"}


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("stage")
    stage.add_argument("--build", type=Path, required=True)
    stage.add_argument("--source-root", type=Path, required=True)
    stage.add_argument("--output", type=Path, required=True)
    stage.add_argument("--per-category", type=int, default=6)
    stage.add_argument("--seed", type=int, default=20260815)
    render = commands.add_parser("render")
    render.add_argument("--stage", type=Path, required=True)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--renderer", type=Path, required=True)
    render.add_argument("--sound-bank", type=Path, required=True)
    render.add_argument("--ffmpeg", default="ffmpeg")
    render.add_argument("--seconds", type=int, default=60)
    render.add_argument("--repeats", type=int, default=6)
    render.add_argument("--seed", type=int, default=20260815)
    args = parser.parse_args()
    if args.command == "stage":
        result = stage_oracle(
            args.build, args.source_root, args.output,
            args.per_category, args.seed)
    else:
        result = render_oracle(
            args.stage, args.output, args.renderer, args.sound_bank,
            args.ffmpeg, args.seconds, args.repeats, args.seed)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
