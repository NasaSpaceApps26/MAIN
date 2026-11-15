"""
Mission flights computed by the simulation in app/mission/misja.py.

One run takes minutes, so it runs in the background: POST starts a job (or returns the cached
result for the same inputs), GET reports progress (the program's own console lines) and,
when finished, the trajectory. Results are cached on disk by their inputs.
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings

RUNNER = Path(__file__).resolve().parents[1] / "mission" / "runner.py"
MODES = ("szybki", "oszczedny")
MAX_PARALLEL = 2  # each run keeps one CPU core busy
_slots = threading.Semaphore(MAX_PARALLEL)
_lock = threading.Lock()


@dataclass
class Job:
    id: str
    params: dict
    status: str = "queued"  # queued | running | done | error
    log: list[str] = field(default_factory=list)
    error: str | None = None
    started: float = field(default_factory=time.time)


_jobs: dict[str, Job] = {}


def _cache_dir() -> Path:
    d = settings.cache_dir / "missions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _bundled_dir() -> Path:
    """Results committed to the repo (e.g. Apollo 11), so the demo opens without waiting."""
    return settings.data_dir / "missions"


# Bump when the result format changes, so results cached by an older version are computed again
# (v2: all texts in English - phase names, events, report).
RESULT_VERSION = "v2"


def job_id(p: dict) -> str:
    key = RESULT_VERSION + "|{launch_utc}|{launch_lat:.4f}|{launch_lon:.4f}|{landing_lat:.4f}|{landing_lon:.4f}|{mode}".format(**p)
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def _result_path(jid: str) -> Path | None:
    for d in (_cache_dir(), _bundled_dir()):
        f = d / f"{jid}.json"
        if f.exists():
            return f
    return None


_STEP = re.compile(r"^\s*\[(\d)/6\]")


class _LogFilter:
    """
    Keeps only the flight's progress lines for the panel. Dropped: the program's header
    (rocket, masses, ephemeris download, azimuth...), the file-saving step and the final
    text report (the result itself is shown from the JSON), and Python tracebacks.
    Error lines ("ERROR: ...") are always kept: they explain a failed run.
    """

    def __init__(self) -> None:
        self.on = False

    def keep(self, line: str) -> bool:
        if line.startswith("ERROR:"):
            return True
        m = _STEP.match(line)
        if m:
            self.on = int(m.group(1)) <= 4      # [1/6]..[4/6]: the flight; [5/6], [6/6]: files, report
        elif line.startswith("Traceback"):
            self.on = False
        return self.on


def _run(job: Job) -> None:
    p = job.params
    with _slots:
        job.status = "running"
        job.started = time.time()
        work = Path(tempfile.mkdtemp(prefix="misja_"))
        out = work / "result.json"
        try:
            proc = subprocess.Popen(
                [sys.executable, "-X", "utf8", str(RUNNER), str(out), p["launch_utc"],
                 str(p["launch_lat"]), str(p["launch_lon"]), str(p["landing_lat"]), str(p["landing_lon"]),
                 p["mode"]],
                cwd=work,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            assert proc.stdout is not None
            shown = _LogFilter()
            for line in proc.stdout:
                line = line.rstrip()
                if line.strip() and shown.keep(line.strip()):
                    job.log.append(line)
                    del job.log[:-400]  # keep the tail only
            proc.wait()
            if proc.returncode != 0 or not out.exists():
                last = next((l for l in reversed(job.log) if l.startswith("ERROR:")), None)
                raise RuntimeError(last or f"The simulation failed (exit code {proc.returncode}).")
            result = json.loads(out.read_text(encoding="utf-8"))
            result["params"] = p
            (_cache_dir() / f"{job.id}.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            job.status = "done"
        except Exception as e:  # noqa: BLE001 - shown to the user
            job.error = str(e)
            job.status = "error"
        finally:
            shutil.rmtree(work, ignore_errors=True)


def start(p: dict) -> str:
    jid = job_id(p)
    with _lock:
        if _result_path(jid):
            return jid
        job = _jobs.get(jid)
        if job and job.status in ("queued", "running"):
            return jid
        job = Job(id=jid, params=p)
        _jobs[jid] = job
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return jid


def status(jid: str) -> dict | None:
    f = _result_path(jid)
    if f:
        return {"id": jid, "status": "done", "log": [], "error": None, "elapsed_s": 0,
                "result": json.loads(f.read_text(encoding="utf-8"))}
    job = _jobs.get(jid)
    if not job:
        return None
    return {"id": jid, "status": job.status, "log": job.log[-40:], "error": job.error,
            "elapsed_s": round(time.time() - job.started), "result": None}
