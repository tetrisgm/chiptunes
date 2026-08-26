import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from build_midi_score_v2 import BuildConfig, run_build
from test_midi_score_v2 import meta, smf, track, vlq


def melody(text=b""):
    events = [meta(0, 0x01, text)] if text else []
    for index, pitch in enumerate((60, 62, 64, 65)):
        events.extend([
            vlq(0 if index == 0 else 24) + bytes((0x90, pitch, 100)),
            vlq(24) + bytes((0x80, pitch, 64)),
        ])
    return smf(track(*events), fmt=0, division=96)


class BuildMidiScoreV2Tests(unittest.TestCase):
    def test_build_is_durable_deduplicated_and_resumable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            output = Path(directory) / "output"
            root.mkdir()
            (root / "a.mid").write_bytes(melody())
            (root / "a-copy.mid").write_bytes(melody())
            (root / "canonical-copy.mid").write_bytes(melody(b"new title"))
            changed = bytearray(melody())
            # Change the first pitch while retaining a structurally valid SMF.
            first_note = changed.index(bytes((0x90, 60, 100)))
            changed[first_note + 1] = 67
            first_off = changed.index(bytes((0x80, 60, 64)))
            changed[first_off + 1] = 67
            (root / "different.mid").write_bytes(changed)
            (root / "bad.mid").write_bytes(b"")
            config = BuildConfig(
                source_root=root, output=output, source_label="fixture",
                authority_note="unit-test fixture", minimum_notes=1,
                minimum_duration96=1, progress_every=1)
            first = run_build(config)
            self.assertEqual("complete", first["status"])
            self.assertEqual({
                "dropped": 2, "kept": 2, "rejected": 1,
            }, first["files"]["statusCounts"])
            self.assertEqual(2, first["music"]["canonicalRoundtripPassed"])
            self.assertTrue(first["machineGate"]["passed"])
            self.assertTrue(first["machineGate"]["onsetMedianTimingPassed"])
            self.assertTrue(first["machineGate"]["durationMedianTimingPassed"])
            self.assertEqual("manifest-threshold-counts",
                             first["timing"]["distribution"]["source"])
            self.assertEqual(first["music"]["notes"],
                             first["timing"]["distribution"]["notes"])
            self.assertLessEqual(first["timing"]["worstFileOnsetMedianMs"], 5)
            self.assertLessEqual(first["timing"]["worstFileDurationMedianMs"], 10)
            self.assertEqual({}, first["familiesAndSplits"]["crossSplitFamilies"])
            self.assertEqual(2, len(list((output / "scores").rglob("*.gz"))))

            manifest_before = (output / "manifest.jsonl").read_bytes()
            second = run_build(config)
            self.assertEqual(first["manifestSha256"], second["manifestSha256"])
            self.assertEqual(manifest_before,
                             (output / "manifest.jsonl").read_bytes())
            progress = json.loads((output / "progress.json").read_text())
            self.assertEqual(("complete", 5, 5), (
                progress["status"], progress["considered"], progress["total"]))

    def test_config_mismatch_refuses_to_reuse_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            output = Path(directory) / "output"
            root.mkdir()
            (root / "a.mid").write_bytes(melody())
            run_build(BuildConfig(
                source_root=root, output=output, source_label="fixture",
                authority_note="test", minimum_notes=1,
                minimum_duration96=1))
            with self.assertRaisesRegex(ValueError, "configuration"):
                run_build(BuildConfig(
                    source_root=root, output=output, source_label="changed",
                    authority_note="test", minimum_notes=1,
                    minimum_duration96=1))

    def test_matching_timing_sidecar_backfills_an_older_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            output = Path(directory) / "output"
            root.mkdir()
            (root / "a.mid").write_bytes(melody())
            config = BuildConfig(
                source_root=root, output=output, source_label="fixture",
                authority_note="test", minimum_notes=1,
                minimum_duration96=1, progress_every=1)
            run_build(config)
            manifest_path = output / "manifest.jsonl"
            rows = [json.loads(line) for line in manifest_path.read_text().splitlines()]
            counts = rows[0]["compound"].pop("timingThresholdCounts")
            manifest_path.write_text("".join(
                json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n"
                for row in rows))
            manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
            timing = output / "timing-audit"
            timing.mkdir()
            (timing / "receipt.json").write_text(json.dumps({
                "status": "complete",
                "corpusManifestSha256": manifest_sha,
                "counts": counts,
            }))
            receipt = run_build(config)
            self.assertTrue(receipt["machineGate"]["passed"])
            self.assertEqual("timing-audit-receipt",
                             receipt["timing"]["distribution"]["source"])


if __name__ == "__main__":
    unittest.main()
