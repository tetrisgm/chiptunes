import gzip
import json
import tempfile
import unittest
from pathlib import Path

from midi_score_v2 import (
    MidiParseError,
    canonical_sha256,
    parse_smf,
    read_score,
    score_bytes,
    write_score,
)


def vlq(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(out))


def meta(delta: int, kind: int, payload: bytes) -> bytes:
    return vlq(delta) + bytes((0xFF, kind)) + vlq(len(payload)) + payload


def track(*events: bytes) -> bytes:
    payload = b"".join(events) + meta(0, 0x2F, b"")
    return b"MTrk" + len(payload).to_bytes(4, "big") + payload


def smf(*tracks: bytes, fmt: int = 1, division: int = 480) -> bytes:
    header = (fmt.to_bytes(2, "big") + len(tracks).to_bytes(2, "big")
              + division.to_bytes(2, "big"))
    return b"MThd" + len(header).to_bytes(4, "big") + header + b"".join(tracks)


class MidiScoreV2Tests(unittest.TestCase):
    def test_preserves_tempo_meter_program_and_note_duration(self) -> None:
        conductor = track(
            meta(0, 0x51, (500000).to_bytes(3, "big")),
            meta(0, 0x58, bytes((4, 2, 24, 8))),
            meta(0, 0x59, bytes((0xFF, 1))),
        )
        music = track(
            meta(0, 0x03, b"Lead"),
            vlq(0) + bytes((0xC2, 41)),
            vlq(0) + bytes((0x92, 60, 100)),
            vlq(480) + bytes((0x82, 60, 64)),
        )
        score = parse_smf(smf(conductor, music), "test.mid")
        self.assertEqual(
            {"type": "ppq", "ticksPerQuarter": 480}, score["division"])
        self.assertEqual(500000, score["tempos"][0]["microsecondsPerQuarter"])
        self.assertEqual(4, score["timeSignatures"][0]["numerator"])
        self.assertEqual(4, score["timeSignatures"][0]["denominator"])
        self.assertEqual(-1, score["keySignatures"][0]["sharps"])
        self.assertTrue(score["keySignatures"][0]["minor"])
        self.assertEqual("Lead", score["trackNames"][0]["name"])
        self.assertEqual({
            "start": 0, "keyEnd": 480, "end": 480, "track": 1,
            "port": 0, "channel": 2, "pitch": 60, "velocity": 100,
            "program": 41, "bankMsb": 0, "bankLsb": 0, "drum": False,
        }, score["notes"][0])

    def test_zero_meter_numerator_is_a_counted_issue(self) -> None:
        score = parse_smf(smf(track(
            meta(0, 0x58, bytes((0, 2, 24, 8))),
        ), fmt=0))
        self.assertEqual([], score["timeSignatures"])
        self.assertEqual(1, score["issues"]["invalidTimeSignatureMeta"])

    def test_keeps_chords_running_status_drums_and_velocity_zero_off(self) -> None:
        music = track(
            vlq(0) + bytes((0x90, 60, 90)),
            vlq(0) + bytes((64, 80)),
            vlq(0) + bytes((67, 70)),
            vlq(120) + bytes((60, 0)),
            vlq(0) + bytes((64, 0)),
            vlq(0) + bytes((67, 0)),
            vlq(0) + bytes((0x99, 36, 110)),
            vlq(30) + bytes((36, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        self.assertEqual(4, len(score["notes"]))
        self.assertEqual(3, score["statistics"]["maxPolyphony"])
        self.assertEqual(1, score["statistics"]["drumNotes"])
        self.assertEqual([60, 64, 67],
                         [n["pitch"] for n in score["notes"][:3]])
        self.assertTrue(score["notes"][3]["drum"])

    def test_sustain_keeps_key_end_and_sounding_end(self) -> None:
        music = track(
            vlq(0) + bytes((0xB0, 64, 127)),
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 64)),
            vlq(120) + bytes((0xB0, 64, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        note = score["notes"][0]
        self.assertEqual((0, 120, 240),
                         (note["start"], note["keyEnd"], note["end"]))
        self.assertEqual([127, 0],
                         [row["value"] for row in score["controls"]])

    def test_channel_mode_messages_close_notes(self) -> None:
        music = track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0xB0, 123, 0)),
            vlq(0) + bytes((0x90, 64, 100)),
            vlq(20) + bytes((0xB0, 120, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        by_pitch = {n["pitch"]: n for n in score["notes"]}
        self.assertEqual(120, by_pitch[60]["end"])
        self.assertEqual(140, by_pitch[64]["end"])
        self.assertNotIn("unterminatedNotes", score["issues"])

    def test_reset_controllers_releases_sustained_notes(self) -> None:
        music = track(
            vlq(0) + bytes((0xB0, 64, 127)),
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 64)),
            vlq(60) + bytes((0xB0, 121, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        self.assertEqual((120, 180),
                         (score["notes"][0]["keyEnd"],
                          score["notes"][0]["end"]))

    def test_overlapping_same_pitch_uses_a_stack(self) -> None:
        music = track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(10) + bytes((0x90, 60, 80)),
            vlq(10) + bytes((0x80, 60, 0)),
            vlq(10) + bytes((0x80, 60, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        by_start = {n["start"]: n for n in score["notes"]}
        self.assertEqual(30, by_start[0]["end"])
        self.assertEqual(20, by_start[10]["end"])

    def test_retains_bend_pressure_sysex_and_generic_meta(self) -> None:
        music = track(
            meta(0, 0x06, b"Verse A"),
            vlq(0) + bytes((0xE1, 0, 96)),
            vlq(0) + bytes((0xA1, 60, 55)),
            vlq(0) + bytes((0xD1, 44)),
            vlq(0) + bytes((0xF0, 2, 0x7D, 0x01)),
        )
        score = parse_smf(smf(music, fmt=0))
        self.assertEqual(4096, score["pitchBends"][0]["value"])
        self.assertEqual(55, score["polyPressure"][0]["value"])
        self.assertEqual(44, score["channelPressure"][0]["value"])
        self.assertEqual("7d01", score["sysex"][0]["dataHex"])
        self.assertTrue(any(row["metaType"] == 0x06
                            for row in score["metaEvents"]))

    def test_retains_but_does_not_invent_end_for_unterminated_notes(self) -> None:
        music = track(vlq(10) + bytes((0x90, 60, 100)))
        score = parse_smf(smf(music, fmt=0))
        self.assertEqual(1, score["issues"]["unterminatedNotes"])
        self.assertEqual([], score["notes"])
        self.assertEqual({
            "tick": 10, "track": 0, "order": 0, "port": 0,
            "channel": 0, "kind": "on", "pitch": 60, "velocity": 100,
        }, score["noteEvents"][0])

    def test_format_one_resolves_global_channel_state_across_tracks(self) -> None:
        first = track(
            vlq(0) + bytes((0xC2, 41)),
            vlq(0) + bytes((0x92, 60, 100)),
        )
        second = track(vlq(120) + bytes((0x82, 60, 64)))
        score = parse_smf(smf(first, second))
        self.assertEqual(1, len(score["notes"]))
        self.assertEqual((0, 120, 41), (
            score["notes"][0]["start"], score["notes"][0]["end"],
            score["notes"][0]["program"]))
        self.assertEqual(0, score["notes"][0]["track"])

    def test_midi_port_scopes_channel_state(self) -> None:
        port_one = track(
            meta(0, 0x21, bytes((1,))),
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 0)),
        )
        port_two = track(
            meta(0, 0x21, bytes((2,))),
            vlq(0) + bytes((0x90, 60, 90)),
            vlq(240) + bytes((0x80, 60, 0)),
        )
        score = parse_smf(smf(port_one, port_two))
        self.assertEqual([(1, 120), (2, 240)],
                         [(n["port"], n["end"]) for n in score["notes"]])

    def test_smpte_division_is_explicit(self) -> None:
        raw = ((256 - 29) << 8) | 80
        score = parse_smf(smf(track(), fmt=0, division=raw))
        self.assertEqual({
            "type": "smpte",
            "fpsCode": 29,
            "framesPerSecondNumerator": 30000,
            "framesPerSecondDenominator": 1001,
            "ticksPerFrame": 80,
        }, score["division"])

    def test_serialization_is_deterministic_and_hash_verified(self) -> None:
        score = parse_smf(smf(track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 0)),
        ), fmt=0), "stable.mid")
        self.assertEqual(score_bytes(score), score_bytes(score))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "track.score.json.gz"
            write_score(path, score)
            loaded = read_score(path)
            self.assertEqual(score, loaded)
            tampered = json.loads(gzip.decompress(path.read_bytes()))
            tampered["notes"][0]["pitch"] = 61
            path.write_bytes(gzip.compress(
                json.dumps(tampered).encode(), mtime=0))
            with self.assertRaisesRegex(MidiParseError, "hash mismatch"):
                read_score(path)

    def test_hash_ignores_source_name_but_not_music(self) -> None:
        raw = smf(track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 0)),
        ), fmt=0)
        first = parse_smf(raw, "a.mid")
        second = parse_smf(raw, "b.mid")
        self.assertEqual(canonical_sha256(first), canonical_sha256(second))
        second["notes"][0]["pitch"] = 61
        self.assertNotEqual(canonical_sha256(first), canonical_sha256(second))

    def test_hash_ignores_text_metadata_and_its_order_offsets(self) -> None:
        music = (
            vlq(0) + bytes((0xC0, 40)),
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 0)),
        )
        plain = parse_smf(smf(track(*music), fmt=0))
        titled = parse_smf(smf(track(meta(0, 0x01, b"different title"),
                                      *music), fmt=0))
        self.assertEqual(plain["canonicalScoreSha256"],
                         titled["canonicalScoreSha256"])

    def test_rejects_format_two_and_bad_running_status(self) -> None:
        with self.assertRaisesRegex(MidiParseError, "format 2"):
            parse_smf(smf(track(), fmt=2))
        bad = track(vlq(0) + bytes((60, 100)))
        with self.assertRaisesRegex(MidiParseError, "running status"):
            parse_smf(smf(bad, fmt=0))


if __name__ == "__main__":
    unittest.main()
