import json
import tempfile
import unittest
from pathlib import Path

from score_midi_score_v2_oracle import score_oracle


def make_batch(path: Path, original_wins=0, disagree_repeats=0):
    key = {}
    verdicts = []
    categories = ("dense", "drum-heavy", "tempo-changing",
                  "sustain-heavy", "general")
    for index in range(30):
        pair_id = f"pair-{index + 1:03d}"
        key[pair_id] = {
            "song": f"song-{index + 1:03d}", "a": "original",
            "b": "roundtrip", "repeat": False, "repeatOf": None,
            "category": categories[index // 6], "relativePath": "x.mid",
        }
        verdicts.append({"id": pair_id,
                         "grade": "a" if index < original_wins else "tie"})
    for index in range(6):
        pair_id = f"pair-{31 + index:03d}"
        original_id = f"pair-{1 + index:03d}"
        key[pair_id] = {
            "song": f"song-{1 + index:03d}", "a": "roundtrip",
            "b": "original", "repeat": True, "repeatOf": original_id,
            "category": categories[index // 2], "relativePath": "x.mid",
        }
        first = verdicts[index]["grade"]
        semantic = "original" if first == "a" else "tie"
        if index < disagree_repeats:
            choice = "a" if semantic != "roundtrip" else "b"
        else:
            choice = "b" if semantic == "original" else "tie"
        verdicts.append({"id": pair_id, "grade": choice})
    (path / "key.json").write_text(json.dumps(key))
    (path / "receipt.json").write_text(json.dumps({"uniqueSongs": 30}))
    (path / "verdicts.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in verdicts))


class ScoreMidiScoreV2OracleTests(unittest.TestCase):
    def test_clean_tied_oracle_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            batch = Path(directory)
            make_batch(batch)
            result = score_oracle(batch, "no-repeated-loss")
            self.assertTrue(result["passed"])
            self.assertEqual({"original": 0, "roundtrip": 0, "tie": 30},
                             result["unique"]["preferences"])
            self.assertEqual(6, result["repeats"]["agreements"])

    def test_original_preference_and_repeat_noise_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            batch = Path(directory)
            make_batch(batch, original_wins=7, disagree_repeats=2)
            result = score_oracle(batch, "no-repeated-loss")
            self.assertFalse(result["passed"])
            self.assertFalse(result["conditions"]["originalPreferenceAtMostSix"])
            self.assertFalse(result["conditions"]["repeatAgreementAtLeastFiveOfSix"])

    def test_owner_repeated_loss_report_is_a_hard_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            batch = Path(directory)
            make_batch(batch)
            result = score_oracle(batch, "repeated-loss")
            self.assertFalse(result["passed"])
            self.assertFalse(
                result["conditions"]["ownerReportsNoRepeatedAudibleLoss"])


if __name__ == "__main__":
    unittest.main()
