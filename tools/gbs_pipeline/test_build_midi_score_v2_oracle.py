import unittest
from pathlib import Path

from build_midi_score_v2_oracle import (
    STRATA,
    _portable_stage_path,
    _stable_renderer_receipt,
    make_instances,
    select_rows,
)


def fixture(index, *, polyphony=2, parts=2, drums=0, tempos=1,
            controls=0, duration=1000):
    notes = 100 + index
    return {
        "relativePath": f"song-{index:03d}.mid",
        "status": "kept",
        "scorePath": f"score-{index}.json.gz",
        "canonicalScoreSha256": f"{index:064x}",
        "scoreStatistics": {
            "notes": notes, "parts": parts, "maxPolyphony": polyphony,
            "drumNotes": drums,
        },
        "scoreCounts": {
            "tempos": tempos, "controls": controls, "pitchBends": 0,
        },
        "compound": {"duration96": duration},
    }


class MidiScoreV2OracleTests(unittest.TestCase):
    def test_renderer_receipt_drops_machine_specific_paths(self):
        receipt = {
            "channels": 2, "frames": 10, "renderedMusicalSeconds": 60,
            "sampleRate": 44100, "sourceSeconds": 90, "tailSeconds": 2,
            "input": "/private/source.mid", "output": "/private/render.wav",
            "soundBank": "/private/bank.dls",
        }
        stable = _stable_renderer_receipt(receipt)
        self.assertNotIn("input", stable)
        self.assertNotIn("output", stable)
        self.assertNotIn("soundBank", stable)
        self.assertEqual(2, stable["channels"])

    def test_stage_paths_are_portable_and_cannot_escape(self):
        stage = Path("/tmp/stage")
        self.assertEqual(
            stage / "midi" / "song-001-original.mid",
            _portable_stage_path(stage, r"midi\song-001-original.mid"))
        self.assertEqual(
            stage / "midi" / "song-001-original.mid",
            _portable_stage_path(stage, "midi/song-001-original.mid"))
        with self.assertRaises(ValueError):
            _portable_stage_path(stage, r"..\outside.mid")
        with self.assertRaises(ValueError):
            _portable_stage_path(stage, r"C:\outside.mid")

    def test_selection_has_exact_family_unique_strata(self):
        rows = []
        scores = {}
        for index in range(80):
            row = fixture(
                index,
                polyphony=20 - index % 10,
                parts=12 - index % 5,
                drums=80 if 15 <= index < 30 else index % 3,
                tempos=10 if 30 <= index < 45 else 1,
                controls=100 if 45 <= index < 60 else 0,
                duration=1000 + index * 100)
            rows.append(row)
            scores[row["relativePath"]] = {
                "controls": ([{"controller": 64}] * 50
                             if 45 <= index < 60 else []),
                "notes": ([{"end": 20, "keyEnd": 10}] * 50
                          if 45 <= index < 60 else []),
            }
        families = {row["relativePath"]: f"family-{index}"
                    for index, row in enumerate(rows)}
        selected = select_rows(
            rows, families, lambda row: scores[row["relativePath"]],
            per_category=3)
        self.assertEqual({category: 3 for category in STRATA}, {
            category: sum(row["category"] == category for row in selected)
            for category in STRATA})
        self.assertEqual(len(selected), len({row["family"] for row in selected}))
        sustain = [row for row in selected if row["category"] == "sustain-heavy"]
        self.assertTrue(all(row["structural"]["sustainedNotes"] == 50
                            for row in sustain))

    def test_instances_are_side_randomized_with_linked_hidden_repeats(self):
        songs = [{"song": f"song-{index:03d}"} for index in range(30)]
        first = make_instances(songs, 6, 42)
        second = make_instances(songs, 6, 42)
        self.assertEqual(first, second)
        self.assertEqual((36, 6),
                         (len(first), sum(row["repeat"] for row in first)))
        originals = {row["id"] for row in first if not row["repeat"]}
        self.assertTrue(all(row["repeatOf"] in originals
                            for row in first if row["repeat"]))
        self.assertEqual({"original", "roundtrip"},
                         {row["sideA"] for row in first})


if __name__ == "__main__":
    unittest.main()
