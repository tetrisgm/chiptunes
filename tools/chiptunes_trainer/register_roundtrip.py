from __future__ import annotations

import argparse
import ctypes
import gzip
import hashlib
import json
import math
import os
import signal
import struct
import subprocess
import sys
import wave
from array import array
from pathlib import Path


SAMPLE_RATE = 44_100
MINIMUM_CORRELATION = 0.999999999
MAXIMUM_PCM_ERROR = 8
MAXIMUM_RMSE = 0.1


def _u32(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 4], "little")


def _put_u32(data: bytearray, offset: int, value: int) -> None:
    struct.pack_into("<I", data, offset, value)


def _wait_commands(samples: int) -> bytes:
    if samples < 0:
        raise ValueError(f"negative VGM wait: {samples}")
    commands = bytearray()
    while samples:
        if samples <= 16:
            commands.append(0x70 + samples - 1)
            break
        chunk = min(samples, 0xFFFF)
        commands.extend((0x61, chunk & 0xFF, chunk >> 8))
        samples -= chunk
    return bytes(commands)


def rebuild_vgm(
    original: bytes,
    register_rows: list[tuple[int, int, int, int]],
    command_samples: int,
) -> bytes:
    """Rebuild one-pass VGM commands from exact timestamped Game Boy writes."""

    data = gzip.decompress(original) if original[:2] == b"\x1f\x8b" else original
    if len(data) < 0x40 or data[:4] != b"Vgm ":
        raise ValueError("source is not a VGM/VGZ file")
    data_relative = _u32(data, 0x34)
    data_offset = 0x34 + data_relative if data_relative else 0x40
    if not 0x40 <= data_offset <= len(data):
        raise ValueError(f"invalid VGM data offset: {data_offset}")
    header = bytearray(data[:data_offset])
    _put_u32(header, 0x14, 0)  # GD3 metadata is outside the rebuilt command stream.
    _put_u32(header, 0x18, command_samples)
    _put_u32(header, 0x1C, 0)
    _put_u32(header, 0x20, 0)

    commands = bytearray()
    sample = 0
    for expected_order, (write_sample, address, value, order) in enumerate(register_rows):
        if order != expected_order:
            raise ValueError(f"register order {order} != {expected_order}")
        if write_sample < sample:
            raise ValueError("register samples are not monotonic")
        commands.extend(_wait_commands(write_sample - sample))
        commands.extend((0xB3, address, value))
        sample = write_sample
    if sample > command_samples:
        raise ValueError(f"last write {sample} exceeds command samples {command_samples}")
    commands.extend(_wait_commands(command_samples - sample))
    commands.append(0x66)

    rebuilt = header + commands
    _put_u32(rebuilt, 0x04, len(rebuilt) - 4)
    return bytes(rebuilt)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _representative_indices(tracks: list[dict], cases: int) -> list[int]:
    groups = {
        kind: [
            index
            for index, track in enumerate(tracks)
            if track["loopKind"] == kind
            and 2 * SAMPLE_RATE <= track["commandSamples"] <= 180 * SAMPLE_RATE
            and (
                kind == "none"
                or track["loopStartSample"] is not None
                and track["loopStartSample"] <= 30 * SAMPLE_RATE
            )
        ]
        for kind in ("none", "intro-plus-loop", "loop-from-start")
    }
    selected = []
    per_group = max(1, math.ceil(cases / len(groups)))
    for kind, indices in groups.items():
        if not indices:
            raise RuntimeError(f"no representative tracks for {kind}")
        ordered = sorted(indices, key=lambda index: (tracks[index]["commandSamples"], tracks[index]["source"]))
        for position in range(per_group):
            fraction = (position + 0.5) / per_group
            selected.append(ordered[min(len(ordered) - 1, int(fraction * len(ordered)))])
    return selected[:cases]


def prepare_cases(dataset: Path, output: Path, cases: int) -> dict:
    import numpy as np

    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable round-trip output {output}")
    tracks = json.loads((dataset / "tracks.json").read_text())
    manifest = json.loads((dataset / "manifest.json").read_text())
    registers = np.load(dataset / "registers.npy", mmap_mode="r")
    offsets = np.load(dataset / "register-offsets.npy", mmap_mode="r")
    indices = _representative_indices(tracks, cases)
    output.mkdir(parents=True)
    rows = []
    corpus = Path(manifest["corpus"])
    for case_number, track_index in enumerate(indices):
        track = tracks[track_index]
        start, end = int(offsets[track_index]), int(offsets[track_index + 1])
        register_rows = [tuple(map(int, row)) for row in registers[start:end]]
        source_path = corpus / Path(track["source"])
        source_bytes = source_path.read_bytes()
        original = gzip.decompress(source_bytes) if source_bytes[:2] == b"\x1f\x8b" else source_bytes
        rebuilt = rebuild_vgm(source_bytes, register_rows, int(track["commandSamples"]))
        name = f"case-{case_number:02d}"
        original_path = output / f"{name}-original.vgm"
        rebuilt_path = output / f"{name}-roundtrip.vgm"
        original_path.write_bytes(original)
        rebuilt_path.write_bytes(rebuilt)
        rows.append(
            {
                "case": name,
                "trackIndex": track_index,
                "source": track["source"],
                "loopKind": track["loopKind"],
                "commandSamples": track["commandSamples"],
                "loopStartSample": track["loopStartSample"],
                "loopSamples": track["loopSamples"],
                "registerWrites": len(register_rows),
                "original": original_path.name,
                "roundtrip": rebuilt_path.name,
                "originalSha256": _sha256(original),
                "roundtripSha256": _sha256(rebuilt),
            }
        )
    report = {
        "schema": "chiptunes-gameboy-register-roundtrip-cases-v1",
        "dataset": str(dataset.resolve()),
        "datasetFingerprint": manifest["contentFingerprint"],
        "cases": rows,
    }
    (output / "cases.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    return report


class GameMusicEmu:
    def __init__(self, library: Path):
        self.library = ctypes.CDLL(str(library))
        self.library.gme_open_file.argtypes = [
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_int,
        ]
        self.library.gme_open_file.restype = ctypes.c_char_p
        self.library.gme_start_track.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.library.gme_start_track.restype = ctypes.c_char_p
        self.library.gme_play.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_int16),
        ]
        self.library.gme_play.restype = ctypes.c_char_p
        self.library.gme_ignore_silence.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.library.gme_set_autoload_playback_limit.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.library.gme_enable_accuracy.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.library.gme_delete.argtypes = [ctypes.c_void_p]

    @staticmethod
    def _check(error: bytes | None) -> None:
        if error:
            raise RuntimeError(error.decode("utf-8", "replace"))

    def render(self, path: Path, frames: int) -> array:
        emulator = ctypes.c_void_p()
        self._check(
            self.library.gme_open_file(
                str(path).encode(),
                ctypes.byref(emulator),
                SAMPLE_RATE,
            )
        )
        try:
            self.library.gme_set_autoload_playback_limit(emulator, 0)
            self.library.gme_ignore_silence(emulator, 1)
            self.library.gme_enable_accuracy(emulator, 1)
            self._check(self.library.gme_start_track(emulator, 0))
            output = array("h")
            remaining = frames
            while remaining:
                chunk_frames = min(remaining, SAMPLE_RATE)
                buffer = (ctypes.c_int16 * (chunk_frames * 2))()
                self._check(self.library.gme_play(emulator, len(buffer), buffer))
                output.extend(buffer)
                remaining -= chunk_frames
            return output
        finally:
            self.library.gme_delete(emulator)


def _write_wave(path: Path, samples: array) -> None:
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(samples.tobytes())


def _comparison(left: array, right: array) -> dict:
    if len(left) != len(right):
        raise RuntimeError(f"PCM lengths differ: {len(left)} != {len(right)}")
    sum_left = sum_right = sum_left2 = sum_right2 = sum_cross = 0.0
    squared_error = 0.0
    max_absolute_error = 0
    different = 0
    nonzero_left = nonzero_right = 0
    peak_left = peak_right = 0
    for left_value, right_value in zip(left, right):
        if left_value:
            nonzero_left += 1
        if right_value:
            nonzero_right += 1
        peak_left = max(peak_left, abs(left_value))
        peak_right = max(peak_right, abs(right_value))
        sum_left += left_value
        sum_right += right_value
        sum_left2 += left_value * left_value
        sum_right2 += right_value * right_value
        sum_cross += left_value * right_value
        difference = left_value - right_value
        squared_error += difference * difference
        if difference:
            different += 1
            max_absolute_error = max(max_absolute_error, abs(difference))
    count = max(1, len(left))
    covariance = sum_cross - sum_left * sum_right / count
    left_variance = sum_left2 - sum_left * sum_left / count
    right_variance = sum_right2 - sum_right * sum_right / count
    denominator = math.sqrt(max(0.0, left_variance) * max(0.0, right_variance))
    correlation = covariance / denominator if denominator else 1.0 if left == right else 0.0
    return {
        "samples": len(left),
        "differentSamples": different,
        "maxAbsoluteError": max_absolute_error,
        "rmse": math.sqrt(squared_error / count),
        "correlation": correlation,
        "bitExact": different == 0,
        "leftNonzeroSamples": nonzero_left,
        "rightNonzeroSamples": nonzero_right,
        "leftPeak": peak_left,
        "rightPeak": peak_right,
        "leftRms": math.sqrt(sum_left2 / count),
        "rightRms": math.sqrt(sum_right2 / count),
    }


def _comparison_passed(row: dict) -> bool:
    minimum_nonzero = max(1, row["samples"] // 1_000)
    return (
        row["correlation"] >= MINIMUM_CORRELATION
        and row["maxAbsoluteError"] <= MAXIMUM_PCM_ERROR
        and row["rmse"] <= MAXIMUM_RMSE
        and row["leftNonzeroSamples"] >= minimum_nonzero
        and row["rightNonzeroSamples"] >= minimum_nonzero
        and row["leftPeak"] > 0
        and row["rightPeak"] > 0
    )


def compare_cases(cases_path: Path, output: Path, library: Path, seconds: int) -> dict:
    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable render output {output}")
    cases_report = json.loads(cases_path.read_text())
    source = cases_path.parent
    output.mkdir(parents=True)
    emulator = GameMusicEmu(library)
    rows = []
    for case in cases_report["cases"]:
        frames = min(int(case["commandSamples"]), seconds * SAMPLE_RATE)
        original_pcm = emulator.render(source / case["original"], frames)
        roundtrip_pcm = emulator.render(source / case["roundtrip"], frames)
        comparison = _comparison(original_pcm, roundtrip_pcm)
        original_wave = output / f"{case['case']}-original.wav"
        roundtrip_wave = output / f"{case['case']}-roundtrip.wav"
        _write_wave(original_wave, original_pcm)
        _write_wave(roundtrip_wave, roundtrip_pcm)
        rows.append(
            {
                **case,
                "renderedFrames": frames,
                "originalPcmSha256": _sha256(original_pcm.tobytes()),
                "roundtripPcmSha256": _sha256(roundtrip_pcm.tobytes()),
                **comparison,
                "originalWave": original_wave.name,
                "roundtripWave": roundtrip_wave.name,
            }
        )
    passed = all(_comparison_passed(row) for row in rows)
    report = {
        "schema": "chiptunes-gameboy-register-roundtrip-render-v1",
        "renderer": str(library.resolve()),
        "sampleRate": SAMPLE_RATE,
        "maximumSecondsPerCase": seconds,
        "thresholds": {
            "minimumCorrelation": MINIMUM_CORRELATION,
            "maximumPcmError": MAXIMUM_PCM_ERROR,
            "maximumRmse": MAXIMUM_RMSE,
            "minimumNonzeroFraction": 0.001,
        },
        "datasetFingerprint": cases_report["datasetFingerprint"],
        "passed": passed,
        "cases": rows,
    }
    (output / "roundtrip-render-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    if not passed:
        raise RuntimeError("Game Boy register round-trip render comparison failed")
    return report


def _run_capped(command: list[str], seconds: int) -> None:
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, _ = process.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise RuntimeError(f"renderer exceeded {seconds}s: {' '.join(command)}")
    if process.returncode:
        raise RuntimeError(
            f"renderer exited {process.returncode}: {' '.join(command)}\n{stdout[-4000:]}"
        )


def _read_wave(path: Path) -> array:
    data = path.read_bytes()
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise RuntimeError(f"{path} is not a RIFF WAVE file")
    format_chunk = audio = None
    position = 12
    while position + 8 <= len(data):
        chunk_name = data[position : position + 4]
        chunk_size = _u32(data, position + 4)
        chunk = data[position + 8 : position + 8 + chunk_size]
        if len(chunk) != chunk_size:
            raise RuntimeError(f"truncated {chunk_name!r} chunk in {path}")
        if chunk_name == b"fmt ":
            format_chunk = chunk
        elif chunk_name == b"data":
            audio = chunk
        position += 8 + chunk_size + (chunk_size & 1)
    if format_chunk is None or audio is None or len(format_chunk) < 16:
        raise RuntimeError(f"missing WAV format or data chunk in {path}")
    format_tag, channels, sample_rate, _, block_align, bits = struct.unpack_from(
        "<HHIIHH", format_chunk
    )
    if format_tag == 0xFFFE:
        if len(format_chunk) < 40:
            raise RuntimeError(f"short WAVE_FORMAT_EXTENSIBLE chunk in {path}")
        format_tag = struct.unpack_from("<H", format_chunk, 24)[0]
    if (
        format_tag != 1
        or channels != 2
        or sample_rate != SAMPLE_RATE
        or bits != 16
        or block_align != 4
    ):
        raise RuntimeError(
            f"unexpected WAV format for {path}: tag={format_tag}, "
            f"{channels}ch/{bits}bit/{sample_rate}Hz, align={block_align}"
        )
    samples = array("h")
    samples.frombytes(audio)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def compare_with_vgm2wav(
    cases_path: Path,
    output: Path,
    renderer: Path,
    renderer_commit: str,
) -> dict:
    if output.exists():
        raise RuntimeError(f"refusing to reuse immutable render output {output}")
    cases_report = json.loads(cases_path.read_text())
    source = cases_path.parent
    output.mkdir(parents=True)
    rows = []
    for case in cases_report["cases"]:
        original_wave = output / f"{case['case']}-original.wav"
        roundtrip_wave = output / f"{case['case']}-roundtrip.wav"
        for vgm_name, wave_path in (
            (case["original"], original_wave),
            (case["roundtrip"], roundtrip_wave),
        ):
            _run_capped(
                [
                    str(renderer),
                    "--samplerate",
                    str(SAMPLE_RATE),
                    "--bps",
                    "16",
                    "--fade",
                    "0",
                    "--loops",
                    "1",
                    str(source / vgm_name),
                    str(wave_path),
                ],
                120,
            )
        original_pcm = _read_wave(original_wave)
        roundtrip_pcm = _read_wave(roundtrip_wave)
        comparison = _comparison(original_pcm, roundtrip_pcm)
        rows.append(
            {
                **case,
                "renderedFrames": len(original_pcm) // 2,
                "originalPcmSha256": _sha256(original_pcm.tobytes()),
                "roundtripPcmSha256": _sha256(roundtrip_pcm.tobytes()),
                **comparison,
                "originalWave": original_wave.name,
                "roundtripWave": roundtrip_wave.name,
            }
        )
    passed = all(_comparison_passed(row) for row in rows)
    report = {
        "schema": "chiptunes-gameboy-register-roundtrip-render-v1",
        "renderer": str(renderer.resolve()),
        "rendererSha256": _sha256(renderer.read_bytes()),
        "rendererSourceCommit": renderer_commit,
        "sampleRate": SAMPLE_RATE,
        "loops": 1,
        "fadeSeconds": 0,
        "thresholds": {
            "minimumCorrelation": MINIMUM_CORRELATION,
            "maximumPcmError": MAXIMUM_PCM_ERROR,
            "maximumRmse": MAXIMUM_RMSE,
            "minimumNonzeroFraction": 0.001,
        },
        "datasetFingerprint": cases_report["datasetFingerprint"],
        "passed": passed,
        "cases": rows,
    }
    (output / "roundtrip-render-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    if not passed:
        raise RuntimeError("Game Boy register round-trip vgm2wav comparison failed")
    return report


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Audit Game Boy register extraction by VGM round trip")
    commands = root.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--dataset", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--cases", type=int, default=12)
    compare = commands.add_parser("compare")
    compare.add_argument("--cases", type=Path, required=True)
    compare.add_argument("--output", type=Path, required=True)
    compare.add_argument("--library", type=Path, required=True)
    compare.add_argument("--seconds", type=int, default=30)
    compare_vgm2wav = commands.add_parser("compare-vgm2wav")
    compare_vgm2wav.add_argument("--cases", type=Path, required=True)
    compare_vgm2wav.add_argument("--output", type=Path, required=True)
    compare_vgm2wav.add_argument("--renderer", type=Path, required=True)
    compare_vgm2wav.add_argument("--renderer-commit", required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.command == "prepare":
        prepare_cases(args.dataset, args.output, args.cases)
    elif args.command == "compare":
        compare_cases(args.cases, args.output, args.library, args.seconds)
    else:
        compare_with_vgm2wav(
            args.cases,
            args.output,
            args.renderer,
            args.renderer_commit,
        )


if __name__ == "__main__":
    main()
