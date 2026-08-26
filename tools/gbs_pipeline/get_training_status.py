"""Report durable training progress without treating process presence as proof.

The trainer atomically writes ``progress.json`` and appends ``history.jsonl``.
This reader derives health, rate, and ETA only from those advancing artifacts;
an existing process with a stale receipt is still reported as stalled.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


SCHEMA = "chiptunes-training-status-v1"


def parse_utc(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def latest_history(path: Path) -> dict:
    if not path.is_file():
        return {}
    latest = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                latest = json.loads(line)
    return latest


def status(run_dir: Path, now: dt.datetime | None = None,
           stale_seconds: int = 900) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    run_path = run_dir / "run.json"
    progress_path = run_dir / "progress.json"
    spec = json.loads(run_path.read_text(encoding="utf-8")) \
        if run_path.is_file() else {}
    progress = json.loads(progress_path.read_text(encoding="utf-8")) \
        if progress_path.is_file() else {}
    history = latest_history(run_dir / "history.jsonl")
    step = int(progress.get("step", history.get("step", 0)) or 0)
    total = int(spec.get("totalSteps", 0) or 0)
    updated = parse_utc(progress["utc"]) if progress.get("utc") else None
    age = (now - updated).total_seconds() if updated else None
    if total and step >= total:
        health, reason = "completed", "durable step reached configured total"
    elif step == 0:
        health, reason = "not-started", "no durable training step exists"
    elif age is not None and age <= stale_seconds:
        health, reason = "advancing", "durable progress receipt is recent"
    else:
        health, reason = "stalled", "durable progress receipt is stale"

    tokens_per_second = history.get("tokensPerSecond")
    batch = int(spec.get("batchSize", 0) or 0)
    context = int(spec.get("context", 0) or 0)
    steps_per_hour = None
    eta_seconds = None
    if tokens_per_second and batch and context:
        steps_per_hour = float(tokens_per_second) * 3600 / (batch * context)
        if total > step:
            eta_seconds = (total - step) / steps_per_hour * 3600

    checkpoints = {}
    checkpoint_ages = []
    for name in ("latest.pt", "best.pt"):
        path = run_dir / name
        modified = (dt.datetime.fromtimestamp(path.stat().st_mtime,
                                              dt.timezone.utc)
                    if path.is_file() else None)
        if modified:
            checkpoint_ages.append((now - modified).total_seconds())
        checkpoints[name] = ({
            "bytes": path.stat().st_size,
            "modifiedUtc": modified.isoformat(),
        } if path.is_file() else None)
    progress_tps = progress.get("tokensPerSecond")
    progress_sph = progress.get("stepsPerHour")
    progress_samples = progress.get("samplesPerHour")
    return {
        "schema": SCHEMA,
        "checkedUtc": now.isoformat(),
        "health": health,
        "reason": reason,
        "step": step,
        "totalSteps": total or None,
        "percent": round(step / total * 100, 2) if total else None,
        "progressUpdatedUtc": updated.isoformat() if updated else None,
        "progressAgeSeconds": round(age, 1) if age is not None else None,
        "staleAfterSeconds": stale_seconds,
        "recentLoss": progress.get("recentLoss"),
        "validationLoss": history.get("valLoss"),
        "tokensPerSecond": progress_tps or tokens_per_second,
        "stepsPerHour": (progress_sph if progress_sph is not None else
                         (round(steps_per_hour, 2)
                          if steps_per_hour is not None else None)),
        "samplesPerHour": progress_samples,
        "etaSeconds": (progress.get("etaSeconds")
                       if progress.get("etaSeconds") is not None else
                       (round(eta_seconds) if eta_seconds is not None else None)),
        "host": progress.get("host") or spec.get("host"),
        "hostBootId": progress.get("hostBootId") or spec.get("hostBootId"),
        "checkpointStep": progress.get("checkpointStep"),
        "lastCheckpointAgeSeconds": (round(min(checkpoint_ages), 1)
                                     if checkpoint_ages else None),
        "checkpoints": checkpoints,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--stale-seconds", type=int, default=900)
    args = parser.parse_args()
    print(json.dumps(status(args.run_dir, stale_seconds=args.stale_seconds),
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
