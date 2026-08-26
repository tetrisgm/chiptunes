from __future__ import annotations

import gzip
import hashlib
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

SAMPLE_RATE = 44100
TEMPO_MIN = 48
TEMPO_MAX = 320
TEMPO_STEP = 4
ROLE_NAMES = ("lead", "counter", "harmony", "bass", "percussion", "end", "time")
FEATURE_NAMES = (
    "dt",
    "role",
    "pitch",
    "interval",
    "duration",
    "velocity",
    "patch",
    "barpos",
    "progress",
    "channel",
    "fineStep",
    "fineDuration",
)
REGISTER_WRITE_FIELDS = ("sample", "address", "value", "order")
EXACT_EVENT_FIELDS = (
    "sample",
    "channel",
    "pitchCents",
    "velocityQ15",
    "patch",
    "role",
    "order",
    "registerOrder",
)
GAMEBOY_REGISTER_COUNT = 0x30
GAMEBOY_REGISTER_MASK_BYTES = GAMEBOY_REGISTER_COUNT // 8
TRIGGER_STATE_FIELDS = tuple(
    [f"register0x{address:02X}" for address in range(GAMEBOY_REGISTER_COUNT)]
    + [f"knownMask{index}" for index in range(GAMEBOY_REGISTER_MASK_BYTES)]
)
CHANNEL_CODES = {
    "gb_pulse1": 0,
    "gb_pulse2": 1,
    "gb_wave": 2,
    "gb_noise": 3,
    "nes_pulse1": 0,
    "nes_pulse2": 1,
    "nes_triangle": 2,
    "nes_noise": 3,
}


@dataclass
class Event:
    time: float
    channel: str
    midi: float | None
    velocity: float
    patch: dict
    role: int = 0
    sample: int = 0
    register_order: int = -1


@dataclass
class RegisterWrite:
    sample: int
    address: int
    value: int
    order: int


@dataclass
class Track:
    source: str
    platform: str
    soundtrack: str
    bpm: int
    duration: float
    events: list[Event] = field(default_factory=list)
    register_writes: list[RegisterWrite] = field(default_factory=list)
    vgm_version: int = 0
    header_total_samples: int = 0
    command_samples: int = 0
    loop_offset: int | None = None
    loop_start_sample: int | None = None
    loop_samples: int = 0
    loop_valid: bool = False
    loop_kind: str = "none"


def _u16(data: bytes, pos: int) -> int:
    return int.from_bytes(data[pos : pos + 2], "little")


def _u32(data: bytes, pos: int) -> int:
    return int.from_bytes(data[pos : pos + 4], "little")


def _midi(freq: float) -> float:
    return 69 + 12 * math.log2(freq / 440)


def _operand_count(cmd: int) -> int:
    if cmd == 0x4F:
        return 1
    if 0x51 <= cmd <= 0x5F or 0xA0 <= cmd <= 0xBF:
        return 2
    if 0xC0 <= cmd <= 0xDF:
        return 3
    if cmd in (0xE0, 0xE1):
        return 4
    if cmd in (0x90, 0x91):
        return 4
    if cmd == 0x92:
        return 5
    if cmd == 0x93:
        return 10
    if cmd == 0x94:
        return 1
    if cmd == 0x95:
        return 4
    if 0x30 <= cmd <= 0x3F:
        return 1
    return 0


def _patch_id(patch: dict) -> str:
    import json

    return json.dumps(patch, sort_keys=True, separators=(",", ":"))


def parse_vgm(path: Path, root: Path, max_seconds: int = 0) -> Track | None:
    raw = path.read_bytes()
    data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    if len(data) < 0x40 or data[:4] != b"Vgm ":
        return None
    rel = path.relative_to(root)
    platform = rel.parts[0].lower()
    soundtrack = rel.parts[1] if len(rel.parts) > 2 else path.parent.name
    data_off = _u32(data, 0x34)
    pos = 0x34 + data_off if data_off else 0x40
    eof_off = _u32(data, 0x04)
    eof = min(len(data), eof_off + 4) if eof_off else len(data)
    version = _u32(data, 0x08)
    total_samples = _u32(data, 0x18)
    loop_relative = _u32(data, 0x1C)
    loop_samples = _u32(data, 0x20)
    loop_offset = 0x1C + loop_relative if loop_relative else None
    loop_offset_in_range = loop_offset is not None and pos <= loop_offset < eof
    loop_start_sample = None
    sample_limit = total_samples or 20 * 60 * SAMPLE_RATE
    if max_seconds:
        sample_limit = min(sample_limit, max_seconds * SAMPLE_RATE)
    regs = {
        "nes_pulse1": [0, 0, 0, 0],
        "nes_pulse2": [0, 0, 0, 0],
        "nes_triangle": [0, 0, 0, 0],
        "nes_noise": [0, 0, 0, 0],
        "gb_pulse1": {},
        "gb_pulse2": {},
        "gb_wave": {"wave": [8] * 32},
        "gb_noise": {},
    }
    events: list[Event] = []
    register_writes: list[RegisterWrite] = []
    sample = 0

    def emit(channel: str, midi: float | None, velocity: float, patch: dict) -> None:
        if midi is not None and not (12 <= midi <= 108):
            return
        if velocity <= 0.005:
            return
        register_order = len(register_writes) - 1 if channel.startswith("gb_") else -1
        events.append(
            Event(
                sample / SAMPLE_RATE,
                channel,
                midi,
                velocity,
                patch,
                sample=sample,
                register_order=register_order,
            )
        )

    while pos < eof and sample < sample_limit:
        if loop_offset_in_range and pos == loop_offset:
            loop_start_sample = sample
        cmd = data[pos]
        pos += 1
        if cmd == 0x66:
            break
        if cmd == 0x61:
            sample += _u16(data, pos)
            pos += 2
            continue
        if cmd == 0x62:
            sample += 735
            continue
        if cmd == 0x63:
            sample += 882
            continue
        if 0x70 <= cmd <= 0x7F:
            sample += (cmd & 15) + 1
            continue
        if 0x80 <= cmd <= 0x8F:
            sample += cmd & 15
            continue
        if cmd == 0x67:
            if data[pos] == 0x66:
                pos += 1
            pos += 1
            size = _u32(data, pos)
            pos += 4 + size
            continue
        if cmd == 0x68:
            pos += 11
            continue
        if cmd == 0xB4 and pos + 1 < eof:
            addr, value = data[pos], data[pos + 1]
            pos += 2
            absolute = 0x4000 + addr if addr < 0x20 else addr
            if 0x4000 <= absolute <= 0x4007:
                name = "nes_pulse1" if absolute < 0x4004 else "nes_pulse2"
                base = 0x4000 if name.endswith("1") else 0x4004
                r = regs[name]
                r[absolute - base] = value
                if absolute - base == 3:
                    timer = r[2] | ((r[3] & 7) << 8)
                    if timer > 7:
                        control, sweep = r[0], r[1]
                        duty = (control >> 6) & 3
                        vel = (control & 15) / 15
                        patch = {
                            "type": "pulse",
                            "system": "nes",
                            "duty": (0.125, 0.25, 0.5, 0.75)[duty],
                            "envelope": {
                                "initial": vel,
                                "rate": control & 15,
                                "constant": bool(control & 0x10),
                                "loop": bool(control & 0x20),
                            },
                            "sweep": {
                                "period": (sweep >> 4) & 7,
                                "shift": sweep & 7,
                                "direction": "down" if sweep & 8 else "up",
                                "enabled": bool(sweep & 0x80),
                            },
                        }
                        emit(name, _midi(1789773 / (16 * (timer + 1))), vel, patch)
            elif 0x4008 <= absolute <= 0x400B:
                r = regs["nes_triangle"]
                r[absolute - 0x4008] = value
                if absolute == 0x400B:
                    timer = r[2] | ((r[3] & 7) << 8)
                    if timer > 7:
                        emit("nes_triangle", _midi(1789773 / (32 * (timer + 1))), 0.7, {"type": "triangle", "system": "nes"})
            elif 0x400C <= absolute <= 0x400F:
                r = regs["nes_noise"]
                r[absolute - 0x400C] = value
                if absolute == 0x400F:
                    control, period = r[0], r[2]
                    vel = (control & 15) / 15
                    emit(
                        "nes_noise",
                        None,
                        vel,
                        {
                            "type": "noise",
                            "system": "nes",
                            "mode": 7 if period & 0x80 else 15,
                            "period": period & 15,
                            "envelope": {
                                "initial": vel,
                                "rate": control & 15,
                                "constant": bool(control & 0x10),
                                "loop": bool(control & 0x20),
                            },
                        },
                    )
            continue
        if cmd == 0xB3 and pos + 1 < eof:
            addr, value = data[pos], data[pos + 1]
            pos += 2
            register_writes.append(RegisterWrite(sample, addr, value, len(register_writes)))
            if 0x20 <= addr <= 0x2F:
                wave = regs["gb_wave"]["wave"]
                wave[(addr - 0x20) * 2] = (value >> 4) & 15
                wave[(addr - 0x20) * 2 + 1] = value & 15
                continue
            if 0x00 <= addr <= 0x04 or 0x06 <= addr <= 0x09:
                name, base = ("gb_pulse1", 0) if addr <= 0x04 else ("gb_pulse2", 5)
                r = regs[name]
                r[addr] = value
                if addr == base + 4 and value & 0x80:
                    x = r.get(base + 3, 0) | ((value & 7) << 8)
                    env, sweep = r.get(base + 2, 0xF0), r.get(base, 0)
                    vel, duty = ((env >> 4) & 15) / 15, (r.get(base + 1, 0) >> 6) & 3
                    patch = {
                        "type": "pulse",
                        "system": "gameboy",
                        "duty": (0.125, 0.25, 0.5, 0.75)[duty],
                        "envelope": {"initial": vel, "rate": env & 7, "direction": "up" if env & 8 else "down"},
                    }
                    if name == "gb_pulse1":
                        patch["sweep"] = {
                            "period": (sweep >> 4) & 7,
                            "shift": sweep & 7,
                            "direction": "down" if sweep & 8 else "up",
                        }
                    emit(name, _midi(131072 / max(1, 2048 - x)), vel, patch)
                continue
            if 0x0A <= addr <= 0x0E:
                r = regs["gb_wave"]
                r[addr] = value
                if addr == 0x0E and value & 0x80:
                    x = r.get(0x0D, 0) | ((value & 7) << 8)
                    level = (r.get(0x0C, 0x20) >> 5) & 3
                    vel = (0, 1, 0.5, 0.25)[level]
                    table4 = list(r["wave"])
                    emit(
                        "gb_wave",
                        _midi(65536 / max(1, 2048 - x)),
                        vel,
                        {"type": "wave", "system": "gameboy", "level": vel, "table4bit": table4, "table": [(v - 7.5) / 7.5 for v in table4]},
                    )
                continue
            if 0x10 <= addr <= 0x13:
                r = regs["gb_noise"]
                r[addr] = value
                if addr == 0x13 and value & 0x80:
                    env, poly = r.get(0x11, 0xF0), r.get(0x12, 0)
                    vel = ((env >> 4) & 15) / 15
                    emit(
                        "gb_noise",
                        None,
                        vel,
                        {
                            "type": "noise",
                            "system": "gameboy",
                            "mode": 7 if poly & 8 else 15,
                            "period": poly & 7,
                            "clockShift": poly >> 4,
                            "envelope": {"initial": vel, "rate": env & 7, "direction": "up" if env & 8 else "down"},
                        },
                    )
                continue
            continue
        pos += _operand_count(cmd)

    if len(events) < 8:
        return None
    command_samples = sample
    duration = (total_samples or command_samples) / SAMPLE_RATE
    bpm = estimate_bpm(events, min(duration, sample / SAMPLE_RATE))
    assign_roles(events)
    loop_valid = (
        loop_offset_in_range
        and loop_start_sample is not None
        and loop_samples > 0
        and loop_start_sample + loop_samples <= command_samples
    )
    if loop_valid:
        loop_kind = "loop-from-start" if loop_start_sample == 0 else "intro-plus-loop"
    elif loop_relative or loop_samples:
        loop_kind = "invalid"
    else:
        loop_kind = "none"
    return Track(
        str(rel),
        platform,
        soundtrack,
        bpm,
        duration,
        events,
        register_writes=register_writes,
        vgm_version=version,
        header_total_samples=total_samples,
        command_samples=command_samples,
        loop_offset=loop_offset,
        loop_start_sample=loop_start_sample,
        loop_samples=loop_samples,
        loop_valid=loop_valid,
        loop_kind=loop_kind,
    )


def estimate_bpm(events: list[Event], duration: float) -> int:
    if len(events) < 24:
        return 120
    bin_sec = 0.025
    end = min(120, duration, events[-1].time)
    count = max(1, math.ceil(end / bin_sec))
    bins = [0.0] * count
    for event in events:
        i = int(event.time / bin_sec)
        if i < count:
            bins[i] += 1.25 if event.midi is None else 1
    scores: dict[int, float] = {}
    for bpm in range(60, 301):
        step = 60 / bpm / bin_sec
        score = 0.0
        for i, value in enumerate(bins):
            if not value:
                continue
            phase = i / step
            d = abs(phase - round(phase))
            eighth = abs(phase * 2 - round(phase * 2))
            score += value * (math.exp(-d * d * 90) + 0.45 * math.exp(-eighth * eighth * 90))
        score /= len(events)
        scores[bpm] = score
    best_bpm = max(scores, key=scores.get)
    while best_bpm > 220:
        half = round(best_bpm / 2)
        neighborhood = range(max(60, half - 2), min(300, half + 2) + 1)
        best_bpm = max(neighborhood, key=scores.get)
    # A pulse and its double-time grid often explain the same trigger stream.
    # Prefer the slower pulse only when it retains nearly all of the alignment;
    # genuinely fast material remains fast when its half-time fit is weaker.
    while best_bpm >= 120:
        half = round(best_bpm / 2)
        neighborhood = range(max(60, half - 2), min(300, half + 2) + 1)
        candidate = max(neighborhood, key=scores.get)
        if scores[candidate] < scores[best_bpm] * 0.94:
            break
        best_bpm = candidate
    return best_bpm


def tempo_bin(bpm: int) -> int:
    return max(0, min((TEMPO_MAX - TEMPO_MIN) // TEMPO_STEP, round((bpm - TEMPO_MIN) / TEMPO_STEP)))


def assign_roles(events: list[Event]) -> None:
    by_channel: dict[str, list[Event]] = {}
    for event in events:
        by_channel.setdefault(event.channel, []).append(event)
    for name, rows in by_channel.items():
        notes = sorted(event.midi for event in rows if event.midi is not None)
        median = notes[len(notes) // 2] if notes else 60
        if "noise" in name:
            role = 4
        elif "triangle" in name or median < 52:
            role = 3
        elif "pulse2" in name or "wave" in name:
            role = 2 if median < 62 else 1
        else:
            role = 0
        for event in rows:
            event.role = role


def normalized_track_hash(features: list[list[int]]) -> str:
    digest = hashlib.sha256()
    previous_fine_step = 0
    for row in features:
        if row[1] >= 5:
            continue
        fine_step = row[10]
        digest.update(
            struct.pack(
                "<iBBBBH",
                fine_step - previous_fine_step,
                row[9],
                row[3],
                row[5],
                min(255, row[11]),
                row[6],
            )
        )
        previous_fine_step = fine_step
    return digest.hexdigest()


def quantize_track(track: Track, patch_ids: dict[str, int]) -> list[list[int]]:
    step_sec = 60 / track.bpm / 4
    rows: list[list[int]] = []
    previous_step = 0
    previous_pitch = [60] * 5
    ordered = sorted(track.events, key=lambda event: (event.time, event.role, event.channel))
    for index, event in enumerate(ordered):
        step = max(0, round(event.time / step_sec))
        next_time = track.duration
        for following in ordered[index + 1 :]:
            if following.channel == event.channel:
                next_time = following.time
                break
        duration = max(1, min(32, round(max(step_sec, next_time - event.time) / step_sec)))
        dt = max(0, step - previous_step)
        while dt > 32:
            rows.append([32, 6, 0, 24, 1, 0, 0, previous_step % 16, min(15, int(previous_step / max(1, track.duration / step_sec) * 16)), 4, previous_step * 8, 1])
            previous_step += 32
            dt -= 32
        pitch = round(event.midi) if event.midi is not None else 24
        interval = max(-24, min(24, pitch - previous_pitch[event.role])) if event.role < 4 else 0
        if event.role < 4:
            previous_pitch[event.role] = pitch
        patch_key = _patch_id(event.patch)
        if patch_key not in patch_ids:
            patch_ids[patch_key] = len(patch_ids) + 1
        progress = min(15, int(step / max(1, track.duration / step_sec) * 16))
        fine_step = max(0, round(event.time / (step_sec / 8)))
        fine_duration = max(1, min(256, round(max(step_sec / 8, next_time - event.time) / (step_sec / 8))))
        rows.append(
            [
                min(32, dt),
                event.role,
                max(0, min(84, pitch - 24)),
                interval + 24,
                duration,
                max(0, min(7, round(event.velocity * 7))),
                patch_ids[patch_key],
                step % 16,
                progress,
                CHANNEL_CODES[event.channel],
                fine_step,
                fine_duration,
            ]
        )
        previous_step = step
    rows.append([0, 5, 0, 24, 1, 0, 0, previous_step % 16, 15, 4, previous_step * 8, 1])
    return rows


def _exact_event_order(event: Event) -> tuple[int, int, int, str]:
    register_order = event.register_order if event.register_order >= 0 else 1 << 60
    return event.sample, register_order, event.role, event.channel


def exact_event_rows(track: Track, patch_ids: dict[str, int]) -> list[list[int]]:
    rows = []
    for order, event in enumerate(sorted(track.events, key=_exact_event_order)):
        rows.append(
            [
                event.sample,
                CHANNEL_CODES[event.channel],
                round(event.midi * 100) if event.midi is not None else -1,
                max(0, min(32767, round(event.velocity * 32767))),
                patch_ids[_patch_id(event.patch)],
                event.role,
                order,
                event.register_order,
            ]
        )
    return rows


def trigger_state_rows(track: Track) -> list[bytes]:
    """Return the exact known Game Boy register state at every derived trigger.

    The first 0x30 bytes are register values. The final six bytes are a bitset
    that distinguishes an unwritten register from a register explicitly written
    with zero. Rows use the same ordering as ``exact_event_rows``.
    """

    values = bytearray(GAMEBOY_REGISTER_COUNT)
    known = bytearray(GAMEBOY_REGISTER_MASK_BYTES)
    cursor = 0
    rows = []
    ordered = sorted(track.events, key=_exact_event_order)
    for event in ordered:
        if event.register_order < 0:
            rows.append(bytes(values + known))
            continue
        if event.register_order >= len(track.register_writes):
            raise ValueError(
                f"{track.source}: trigger register order {event.register_order} "
                f"exceeds {len(track.register_writes)} writes"
            )
        if event.register_order < cursor:
            raise ValueError(
                f"{track.source}: trigger register order {event.register_order} "
                "is not monotonic at a shared sample clock"
            )
        while cursor <= event.register_order:
            write = track.register_writes[cursor]
            if 0 <= write.address < GAMEBOY_REGISTER_COUNT:
                values[write.address] = write.value
                known[write.address // 8] |= 1 << (write.address % 8)
            cursor += 1
        rows.append(bytes(values + known))
    return rows
