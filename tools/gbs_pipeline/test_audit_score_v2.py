import copy
import unittest

from audit_score_v2 import (
    ScoreTimeMap,
    assign_family_splits,
    build_family_assignments,
    normalized_score_sha256,
    score_fingerprints,
    split_leaks,
)
from midi_score_v2 import canonical_sha256


def score(notes, *, ppq=96, source="a", tempos=None):
    value = {
        "source": {"sha256": source},
        "division": {"type": "ppq", "ticksPerQuarter": ppq},
        "notes": [
            {"start": start, "end": end, "track": 0, "port": 0,
             "channel": 0, "pitch": pitch, "velocity": 100,
             "program": 0, "bankMsb": 0, "bankLsb": 0, "drum": drum}
            for start, end, pitch, drum in notes
        ],
        "noteEvents": [], "tempos": tempos or [], "timeSignatures": [],
        "keySignatures": [], "programChanges": [], "controls": [],
        "pitchBends": [], "polyPressure": [], "channelPressure": [],
        "sysex": [], "trackEndTicks": [max((n[1] for n in notes), default=0)],
    }
    value["canonicalScoreSha256"] = canonical_sha256(value)
    return value


class ScoreV2AuditTests(unittest.TestCase):
    def test_ppq_time_map_is_tempo_independent(self):
        value = score([], ppq=480, tempos=[{
            "tick": 0, "track": 0, "order": 0,
            "microsecondsPerQuarter": 900_000,
        }])
        self.assertEqual(144, ScoreTimeMap(value).q96(720))

    def test_normalized_hash_ignores_tempo_scale_transposition_and_pickup(self):
        original = score([
            (0, 48, 60, False), (48, 96, 64, False),
            (96, 192, 67, False),
        ], ppq=96)
        transformed = score([
            (240, 336, 65, False), (336, 432, 69, False),
            (432, 624, 72, False),
        ], ppq=192, source="b")
        self.assertEqual(normalized_score_sha256(original),
                         normalized_score_sha256(transformed))
        self.assertNotEqual(original["canonicalScoreSha256"],
                            transformed["canonicalScoreSha256"])

    def test_drum_keys_are_not_transposed(self):
        first = score([(0, 24, 36, True), (24, 48, 38, True)])
        second = score([(0, 24, 41, True), (24, 48, 43, True)], source="b")
        self.assertNotEqual(normalized_score_sha256(first),
                            normalized_score_sha256(second))

    def test_exact_normalized_duplicates_share_family(self):
        first = score([(i * 24, i * 24 + 12, 60 + i % 5, False)
                       for i in range(32)], source="bytes-a")
        second = score([(i * 48 + 96, i * 48 + 120, 67 + i % 5, False)
                        for i in range(32)], ppq=192, source="bytes-b")
        families = build_family_assignments([
            {"id": "first", "score": first},
            {"id": "second", "score": second},
        ])
        self.assertEqual(families["first"], families["second"])

    def test_structural_near_match_tolerates_one_changed_note(self):
        notes = [(i * 24, i * 24 + 18, 60 + (i * 3) % 17, False)
                 for i in range(128)]
        first = score(notes, source="bytes-a")
        changed = list(notes)
        start, end, pitch, drum = changed[63]
        changed[63] = (start, end, pitch + 2, drum)
        second = score(changed, source="bytes-b")
        first_fp, second_fp = score_fingerprints(first), score_fingerprints(second)
        self.assertNotEqual(first_fp["normalizedScoreSha256"],
                            second_fp["normalizedScoreSha256"])
        families = build_family_assignments([
            {"id": "first", "fingerprints": first_fp},
            {"id": "second", "fingerprints": second_fp},
        ])
        self.assertEqual(families["first"], families["second"])

    def test_different_music_remains_separate(self):
        first = score([(i * 24, i * 24 + 12, 60 + i % 3, False)
                       for i in range(64)], source="a")
        second = score([(i * 17, i * 17 + 5, 35 + (i * 7) % 40, False)
                        for i in range(64)], source="b")
        families = build_family_assignments([
            {"id": "first", "score": first},
            {"id": "second", "score": second},
        ])
        self.assertNotEqual(families["first"], families["second"])

    def test_family_splits_are_deterministic_and_have_no_leakage(self):
        assignments = {"a": "family-1", "b": "family-1",
                       "c": "family-2", "d": "family-3"}
        first = assign_family_splits(assignments, 42)
        second = assign_family_splits(copy.deepcopy(assignments), 42)
        self.assertEqual(first, second)
        self.assertEqual(first["a"], first["b"])
        self.assertEqual({}, split_leaks(assignments, first))


if __name__ == "__main__":
    unittest.main()
