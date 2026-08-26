import unittest

from midi_score_v2 import parse_smf
from render_score_v2 import score_to_smf, verified_score_to_smf, write_vlq
from test_midi_score_v2 import meta, smf, track, vlq


class RenderScoreV2Tests(unittest.TestCase):
    def test_vlq_boundaries(self):
        self.assertEqual(b"\x00", write_vlq(0))
        self.assertEqual(b"\x7f", write_vlq(127))
        self.assertEqual(b"\x81\x00", write_vlq(128))
        self.assertEqual(b"\xff\xff\xff\x7f", write_vlq(0x0FFFFFFF))
        with self.assertRaisesRegex(ValueError, "out of range"):
            write_vlq(0x10000000)

    def test_complex_score_reparses_to_same_canonical_hash(self):
        conductor = track(
            meta(0, 0x03, b"Conductor"),
            meta(0, 0x58, bytes((4, 2, 24, 8))),
            meta(0, 0x51, (500_001).to_bytes(3, "big")),
            meta(0, 0x59, bytes((0xFF, 1))),
        )
        music = track(
            meta(0, 0x21, bytes((2,))),
            vlq(0) + bytes((0xC2, 41)),
            vlq(0) + bytes((0xB2, 64, 127)),
            vlq(0) + bytes((0x92, 60, 100)),
            vlq(0) + bytes((64, 90)),
            vlq(120) + bytes((0x82, 60, 32)),
            vlq(0) + bytes((64, 31)),
            vlq(60) + bytes((0xB2, 64, 0)),
            vlq(0) + bytes((0xE2, 1, 96)),
            vlq(0) + bytes((0xA2, 60, 55)),
            vlq(0) + bytes((0xD2, 44)),
            vlq(0) + bytes((0xF0, 2, 0x7D, 0x01)),
        )
        score = parse_smf(smf(conductor, music))
        payload, reparsed = verified_score_to_smf(score)
        self.assertNotEqual(smf(conductor, music), payload)
        self.assertEqual(score["canonicalScoreSha256"],
                         reparsed["canonicalScoreSha256"])
        self.assertEqual(score["notes"], reparsed["notes"])

    def test_note_on_velocity_zero_normalizes_without_musical_loss(self):
        music = track(
            vlq(0) + bytes((0x90, 60, 100)),
            vlq(120) + bytes((60, 0)),
        )
        score = parse_smf(smf(music, fmt=0))
        reparsed = parse_smf(score_to_smf(score))
        self.assertEqual(score["canonicalScoreSha256"],
                         reparsed["canonicalScoreSha256"])

    def test_smpte_division_roundtrip(self):
        division = ((256 - 29) << 8) | 80
        score = parse_smf(smf(track(), fmt=0, division=division))
        reparsed = parse_smf(score_to_smf(score))
        self.assertEqual(score["division"], reparsed["division"])
        self.assertEqual(score["canonicalScoreSha256"],
                         reparsed["canonicalScoreSha256"])


if __name__ == "__main__":
    unittest.main()
