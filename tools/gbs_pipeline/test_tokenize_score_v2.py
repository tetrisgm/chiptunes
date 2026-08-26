import unittest

from midi_score_v2 import parse_smf
from test_midi_score_v2 import meta, smf, track, vlq
from tokenize_score_v2 import (
    EVENT_KINDS,
    decode_events,
    encode_score,
    represented_events,
)


class CompoundScoreV2Tests(unittest.TestCase):
    def test_compound_roundtrip_preserves_every_represented_factor(self):
        conductor = track(
            meta(0, 0x58, bytes((4, 2, 24, 8))),
            meta(0, 0x51, (500_001).to_bytes(3, "big")),
            meta(0, 0x59, bytes((0xFE, 1))),
        )
        music = track(
            vlq(0) + bytes((0xC2, 41)),
            vlq(0) + bytes((0x92, 60, 100)),
            vlq(0) + bytes((64, 80)),
            vlq(480) + bytes((0x82, 60, 64)),
            vlq(0) + bytes((64, 64)),
        )
        score = parse_smf(smf(conductor, music, division=480))
        compound = encode_score(score)
        represented = represented_events(compound)
        self.assertEqual({
            "kind": "METER", "q96": 0, "numerator": 4,
            "denominator": 4,
        }, represented[0])
        self.assertEqual(500_001, represented[1]["microsecondsPerQuarter"])
        self.assertEqual((-2, True),
                         (represented[2]["sharps"], represented[2]["minor"]))
        notes = [row for row in represented if row["kind"] == "NOTE"]
        self.assertEqual([
            (0, 1, 5, 60, 96, 100),
            (0, 1, 5, 64, 96, 80),
        ], [(row["q96"], row["part"], row["programFamily"], row["pitch"],
             row["duration96"], row["velocity"]) for row in notes])
        self.assertEqual(0.0, compound["statistics"]["onsetErrorMsP99"])
        self.assertEqual(0.0, compound["statistics"]["durationErrorMsP99"])

    def test_bar_beat_markers_and_chord_adjacency(self):
        music = track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(0) + bytes((64, 100)),
            vlq(0) + bytes((67, 100)),
            vlq(1920) + bytes((0x80, 60, 0)),
            vlq(0) + bytes((64, 0)),
            vlq(0) + bytes((67, 0)),
        )
        compound = encode_score(parse_smf(smf(music, fmt=0, division=480)))
        decoded = decode_events(compound)
        self.assertEqual(2, sum(row["kind"] == "BAR" for row in decoded))
        self.assertEqual(5, sum(row["kind"] == "BEAT" for row in decoded))
        note_indices = [index for index, row in enumerate(decoded)
                        if row["kind"] == "NOTE"]
        self.assertEqual(list(range(note_indices[0], note_indices[0] + 3)),
                         note_indices)

    def test_mid_bar_meter_change_resets_metric_clock_without_time_loss(self):
        conductor = track(
            meta(0, 0x58, bytes((4, 2, 24, 8))),
            meta(720, 0x58, bytes((3, 3, 24, 8))),
        )
        music = track(
            vlq(720) + bytes((0x90, 60, 100)),
            vlq(360) + bytes((0x80, 60, 0)),
        )
        compound = encode_score(parse_smf(
            smf(conductor, music, division=480)))
        represented = represented_events(compound)
        meters = [row for row in represented if row["kind"] == "METER"]
        notes = [row for row in represented if row["kind"] == "NOTE"]
        self.assertEqual([(0, 4, 4), (144, 3, 8)],
                         [(r["q96"], r["numerator"], r["denominator"])
                          for r in meters])
        self.assertEqual((144, 72), (notes[0]["q96"], notes[0]["duration96"]))

    def test_sustain_uses_sounding_duration(self):
        music = track(
            vlq(0) + bytes((0xB0, 64, 127)),
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 64)),
            vlq(120) + bytes((0xB0, 64, 0)),
        )
        compound = encode_score(parse_smf(
            smf(music, fmt=0, division=120)))
        note = next(row for row in represented_events(compound)
                    if row["kind"] == "NOTE")
        self.assertEqual(192, note["duration96"])
        self.assertEqual(2, sum(row["kind"] == "CONTROL"
                                for row in represented_events(compound)))

    def test_controls_bends_and_pressure_roundtrip_exactly(self):
        music = track(
            vlq(0) + bytes((0xB3, 11, 99)),
            vlq(0) + bytes((0xE3, 1, 96)),
            vlq(0) + bytes((0xA3, 64, 55)),
            vlq(0) + bytes((0xD3, 44)),
        )
        compound = encode_score(parse_smf(smf(music, fmt=0)))
        represented = represented_events(compound)
        self.assertEqual([
            {"kind": "CONTROL", "q96": 0, "part": 1,
             "controller": 11, "value": 99},
            {"kind": "BEND", "q96": 0, "part": 1, "value": 4097},
            {"kind": "POLY_PRESSURE", "q96": 0, "part": 1,
             "pitch": 64, "value": 55},
            {"kind": "CHANNEL_PRESSURE", "q96": 0, "part": 1,
             "value": 44},
        ], represented)

    def test_quantization_error_is_measured_in_playback_time(self):
        music = track(
            meta(0, 0x51, (500_000).to_bytes(3, "big")),
            vlq(1) + bytes((0x90, 60, 100)),
            vlq(10) + bytes((0x80, 60, 0)),
        )
        compound = encode_score(parse_smf(
            smf(music, fmt=0, division=100)))
        self.assertEqual(0.208333, compound["statistics"]["onsetErrorMsP99"])
        self.assertEqual(2.083333,
                         compound["statistics"]["durationErrorMsP99"])

    def test_smpte_timing_roundtrips_through_musical_grid(self):
        raw_division = ((256 - 29) << 8) | 80
        music = track(
            vlq(1200) + bytes((0x90, 60, 100)),
            vlq(1200) + bytes((0x80, 60, 0)),
        )
        compound = encode_score(parse_smf(
            smf(music, fmt=0, division=raw_division)))
        note = next(row for row in represented_events(compound)
                    if row["kind"] == "NOTE")
        self.assertEqual((96, 96), (note["q96"], note["duration96"]))
        self.assertLess(compound["statistics"]["onsetErrorMsP99"], 1.0)
        self.assertLess(compound["statistics"]["durationErrorMsP99"], 1.0)

    def test_rejects_pairing_damage_before_tokenization(self):
        music = track(vlq(0) + bytes((0x90, 60, 100)))
        score = parse_smf(smf(music, fmt=0))
        with self.assertRaisesRegex(ValueError, "unresolved note pairing"):
            encode_score(score)

    def test_decoder_rejects_unknown_part(self):
        music = track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((0x80, 60, 0)),
        )
        compound = encode_score(parse_smf(smf(music, fmt=0)))
        note = next(row for row in compound["events"]
                    if row["kind"] == EVENT_KINDS["NOTE"])
        note["part"] = 99
        with self.assertRaisesRegex(ValueError, "unknown compound part"):
            decode_events(compound)


if __name__ == "__main__":
    unittest.main()
