import tempfile
import unittest
from pathlib import Path

from audit_midi_score_v2_timing import _timing_row
from midi_score_v2 import parse_smf, score_bytes
from test_midi_score_v2 import meta, smf, track, vlq


class MidiScoreV2TimingAuditTests(unittest.TestCase):
    def test_exact_threshold_counts_reconcile_with_score_notes(self):
        events = [meta(0, 0x51, (500_000).to_bytes(3, "big"))]
        for pitch in (60, 64, 67):
            events.extend([
                vlq(0) + bytes((0x90, pitch, 100)),
                vlq(96) + bytes((0x80, pitch, 64)),
            ])
        score = parse_smf(smf(track(*events), fmt=0, division=96), "fixture.mid")
        with tempfile.TemporaryDirectory() as directory:
            build = Path(directory)
            score_path = build / "score.json.gz"
            score_path.write_bytes(score_bytes(score))
            row = _timing_row((str(build), {
                "relativePath": "fixture.mid",
                "scorePath": score_path.name,
                "canonicalScoreSha256": score["canonicalScoreSha256"],
                "scoreStatistics": {"notes": 3},
            }))
        self.assertEqual(3, row["counts"]["notes"])
        self.assertTrue(all(row["counts"][key] == 3 for key in (
            "onsetAtMost5Ms", "onsetAtMost20Ms",
            "durationAtMost10Ms", "durationAtMost40Ms")))


if __name__ == "__main__":
    unittest.main()
