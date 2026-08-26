import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from get_midi_score_v2_status import build_status


class MidiScoreV2StatusTests(unittest.TestCase):
    def test_not_started(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual("not-started",
                             build_status(Path(directory))["state"])

    def test_running_progress_becomes_healthy_or_stalled(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            progress = {
                "status": "running", "updatedUtc": "2026-08-15T00:00:00Z",
                "considered": 1, "total": 10, "fraction": 0.1,
                "sessionFilesPerSecond": 2.0, "etaSeconds": 4.5,
                "current": "a.mid", "statusCounts": {"kept": 1},
                "reasonCounts": {}, "error": None,
            }
            (output / "progress.json").write_text(json.dumps(progress))
            (output / "manifest.jsonl").write_text("{}\n")
            healthy = build_status(
                output, 300,
                datetime(2026, 8, 15, 0, 4, tzinfo=timezone.utc))
            stalled = build_status(
                output, 300,
                datetime(2026, 8, 15, 0, 6, tzinfo=timezone.utc))
            self.assertEqual("healthy", healthy["state"])
            self.assertEqual("stalled", stalled["state"])

    def test_visible_manifest_may_lead_running_fsynced_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            progress = {
                "status": "running", "updatedUtc": "2026-08-15T00:00:00Z",
                "considered": 1, "total": 10, "fraction": 0.1,
                "sessionFilesPerSecond": 2.0, "etaSeconds": 4.5,
                "current": "a.mid", "statusCounts": {"kept": 1},
                "reasonCounts": {}, "error": None,
            }
            (output / "progress.json").write_text(json.dumps(progress))
            (output / "manifest.jsonl").write_text("{}\n{}\n{}\n")
            status = build_status(
                output, 300,
                datetime(2026, 8, 15, 0, 1, tzinfo=timezone.utc))
            self.assertEqual("healthy", status["state"])
            self.assertEqual((1, 3, 2), (
                status["durableCheckpointRows"], status["visibleManifestRows"],
                status["manifestRowsAheadOfCheckpoint"]))

    def test_complete_requires_receipt_and_matching_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            progress = {
                "status": "complete", "updatedUtc": "2026-08-15T00:00:00Z",
                "considered": 2, "total": 2, "fraction": 1.0,
                "sessionFilesPerSecond": 1.0, "etaSeconds": 0,
                "current": None, "statusCounts": {"kept": 2},
                "reasonCounts": {}, "error": None,
            }
            (output / "progress.json").write_text(json.dumps(progress))
            (output / "manifest.jsonl").write_text("{}\n{}\n")
            self.assertEqual("inconsistent", build_status(output)["state"])
            (output / "receipt.json").write_text("{}")
            self.assertEqual("complete", build_status(output)["state"])


if __name__ == "__main__":
    unittest.main()
