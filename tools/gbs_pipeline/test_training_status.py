from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from tools.gbs_pipeline import get_training_status as S


class TrainingStatusTest(unittest.TestCase):
    def test_stale_receipt_is_stalled_even_when_step_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "run.json").write_text(json.dumps({
                "totalSteps": 1000, "batchSize": 10, "context": 100,
            }))
            (run / "progress.json").write_text(json.dumps({
                "step": 250, "utc": "2026-08-14T00:00:00Z",
                "recentLoss": 1.25,
            }))
            (run / "history.jsonl").write_text(json.dumps({
                "step": 200, "tokensPerSecond": 1000, "valLoss": 1.5,
            }) + "\n")
            report = S.status(
                run, dt.datetime(2026, 8, 14, 1, tzinfo=dt.timezone.utc),
                stale_seconds=900)
            self.assertEqual("stalled", report["health"])
            self.assertEqual(25.0, report["percent"])
            self.assertEqual(3600.0, report["stepsPerHour"])
            self.assertIsNone(report["samplesPerHour"])

    def test_progress_v2_reports_instrumentation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "run.json").write_text(json.dumps({
                "totalSteps": 1000, "batchSize": 10, "context": 100,
                "host": "gpu-box", "hostBootId": "boot-1",
            }))
            (run / "progress.json").write_text(json.dumps({
                "step": 250, "checkpointStep": 200,
                "utc": "2026-08-14T00:59:00Z", "recentLoss": 1.25,
                "tokensPerSecond": 1234.5, "stepsPerHour": 4444.0,
                "samplesPerHour": 44440.0, "etaSeconds": 608,
                "host": "gpu-box", "hostBootId": "boot-1",
            }))
            report = S.status(
                run, dt.datetime(2026, 8, 14, 1, tzinfo=dt.timezone.utc),
                stale_seconds=900)
            self.assertEqual("advancing", report["health"])
            self.assertEqual(1234.5, report["tokensPerSecond"])
            self.assertEqual(44440.0, report["samplesPerHour"])
            self.assertEqual("boot-1", report["hostBootId"])
            self.assertEqual(200, report["checkpointStep"])

    def test_total_step_is_completed_even_when_old(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "run.json").write_text(json.dumps({"totalSteps": 10}))
            (run / "progress.json").write_text(json.dumps({
                "step": 10, "utc": "2026-08-14T00:00:00Z",
            }))
            report = S.status(
                run, dt.datetime(2026, 8, 15, tzinfo=dt.timezone.utc))
            self.assertEqual("completed", report["health"])


if __name__ == "__main__":
    unittest.main()
