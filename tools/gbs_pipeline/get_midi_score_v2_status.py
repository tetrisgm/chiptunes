"""Report durable MIDI-v2 corpus progress and detect stale heartbeats."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def manifest_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("rb") as handle:
        return sum(bool(line.strip()) for line in handle)


def build_status(output: Path, stale_seconds: int = 300,
                 now: datetime | None = None) -> dict[str, Any]:
    progress_path = output / "progress.json"
    if not progress_path.exists():
        return {
            "schema": "chiptunes-midi-score-v2-status-v1",
            "state": "not-started",
            "output": str(output),
        }
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    current_time = now or datetime.now(timezone.utc)
    age = max(0.0, (current_time - _parse_utc(
        progress["updatedUtc"])).total_seconds())
    visible_rows = manifest_rows(output / "manifest.jsonl")
    manifest_matches = visible_rows == progress["considered"]
    manifest_at_least_checkpoint = visible_rows >= progress["considered"]
    raw_state = progress["status"]
    if raw_state == "running" and age > stale_seconds:
        state = "stalled"
    elif raw_state == "running" and manifest_at_least_checkpoint:
        state = "healthy"
    elif raw_state == "complete" and progress["considered"] == progress["total"] \
            and manifest_matches and (output / "receipt.json").exists():
        state = "complete"
    elif raw_state == "failed":
        state = "failed"
    else:
        state = "inconsistent"
    return {
        "schema": "chiptunes-midi-score-v2-status-v1",
        "state": state,
        "heartbeatAgeSeconds": round(age, 3),
        "staleAfterSeconds": stale_seconds,
        "considered": progress["considered"],
        "total": progress["total"],
        "fraction": progress["fraction"],
        "durableCheckpointRows": progress["considered"],
        "visibleManifestRows": visible_rows,
        "manifestRowsAheadOfCheckpoint": max(
            0, visible_rows - progress["considered"]),
        "manifestMatchesProgress": manifest_matches,
        "manifestAtLeastCheckpoint": manifest_at_least_checkpoint,
        "filesPerSecond": progress["sessionFilesPerSecond"],
        "etaSeconds": progress["etaSeconds"],
        "current": progress["current"],
        "statusCounts": progress["statusCounts"],
        "reasonCounts": progress["reasonCounts"],
        "error": progress["error"],
        "updatedUtc": progress["updatedUtc"],
        "output": str(output),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--stale-seconds", type=int, default=300)
    args = parser.parse_args()
    if args.stale_seconds < 1:
        raise SystemExit("--stale-seconds must be positive")
    print(json.dumps(build_status(
        args.output, args.stale_seconds), sort_keys=True))


if __name__ == "__main__":
    main()
