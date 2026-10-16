"""Run the API and the worker together for local development.

    python scripts/dev.py              # API on 0.0.0.0:8001 + one worker
    python scripts/dev.py --port 8002  # another port
    python scripts/dev.py --no-worker  # API only

Both read backend/.env. Output is prefixed [api] / [worker]. Ctrl+C stops both;
if either exits on its own the other is stopped too. The API binds 0.0.0.0 so a
phone on the same Wi-Fi can reach it (Expo Go uses the PC's LAN address).
"""

from __future__ import annotations

import argparse
import contextlib
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _pump(name: str, proc: subprocess.Popen[bytes]) -> None:
    assert proc.stdout is not None
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip()
        print(f"[{name}] {line}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--no-worker", action="store_true")
    args = ap.parse_args()
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    py = sys.executable
    commands = {
        "api": [py, "-m", "uvicorn", "app.main:app", "--env-file", ".env",
                "--host", "0.0.0.0", "--port", str(args.port)],
    }
    if not args.no_worker:
        commands["worker"] = [py, "-m", "app.worker"]

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    procs: dict[str, subprocess.Popen[bytes]] = {}
    for name, cmd in commands.items():
        procs[name] = subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT)
        threading.Thread(target=_pump, args=(name, procs[name]), daemon=True).start()
    print(f"[dev] API http://0.0.0.0:{args.port}  (Ctrl+C stops everything)", flush=True)

    code = 0
    try:
        while all(p.poll() is None for p in procs.values()):
            time.sleep(0.5)
        exited = next(n for n, p in procs.items() if p.poll() is not None)
        code = procs[exited].returncode or 0
        print(f"[dev] {exited} exited with code {code}; stopping the rest", flush=True)
    except KeyboardInterrupt:
        print("[dev] stopping", flush=True)
    finally:
        for p in procs.values():
            if p.poll() is None:
                p.terminate()
        for p in procs.values():
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
    return code


if __name__ == "__main__":
    sys.exit(main())
