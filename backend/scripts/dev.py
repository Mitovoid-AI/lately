"""Run the API and the worker together for local development.

    python scripts/dev.py              # API on 0.0.0.0:8001 + one worker
    python scripts/dev.py --port 8002  # another port
    python scripts/dev.py --no-worker  # API only
    python scripts/dev.py --tunnel https://<name>.ngrok-free.dev  # also on that address

Both read backend/.env. Output is prefixed [api] / [worker]. Ctrl+C stops both;
if either exits on its own the other is stopped too. Stopping is graceful: each
child is asked to stop (Ctrl+Break on Windows, SIGTERM elsewhere) and given up
to STOP_TIMEOUT_SECONDS, so the worker can hand its jobs back; Ctrl+C again
kills them at once. The API binds 0.0.0.0 so a
phone on the same Wi-Fi can reach it (Expo Go uses the PC's LAN address).
--tunnel also runs ngrok (signed in, on PATH) as [tunnel], so a phone anywhere
reaches the API over https at the account's fixed ngrok address.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
# The worker's shutdown grace (WORKER_SHUTDOWN_GRACE_SECONDS, 20 s) plus time to
# hand its jobs back and close; anything still running after this is killed.
STOP_TIMEOUT_SECONDS = 35.0
WINDOWS = sys.platform == "win32"
# Windows: each child in its own process group, so Ctrl+C in this console
# reaches only dev.py and each child can be sent Ctrl+Break on its own.
POPEN_FLAGS = subprocess.CREATE_NEW_PROCESS_GROUP if WINDOWS else 0


def stop_all(procs: dict[str, subprocess.Popen[bytes]],
             timeout: float = STOP_TIMEOUT_SECONDS) -> None:
    """Ask every running child to stop, wait up to `timeout` for all of them,
    then kill whatever is left. Ctrl+C while waiting kills them at once."""
    for p in procs.values():
        if p.poll() is None:
            try:
                p.send_signal(signal.CTRL_BREAK_EVENT if WINDOWS else signal.SIGTERM)
            except OSError:  # no console to send Ctrl+Break through
                p.terminate()
    deadline = time.monotonic() + timeout
    try:
        for p in procs.values():
            with contextlib.suppress(subprocess.TimeoutExpired):
                p.wait(timeout=max(0.0, deadline - time.monotonic()))
    except KeyboardInterrupt:
        print("[dev] killing", flush=True)
    for name, p in procs.items():
        if p.poll() is None:
            print(f"[dev] {name} did not stop; killing it", flush=True)
            p.kill()
            with contextlib.suppress(subprocess.TimeoutExpired):
                p.wait(timeout=5)


def _pump(name: str, proc: subprocess.Popen[bytes]) -> None:
    assert proc.stdout is not None
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip()
        print(f"[{name}] {line}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--no-worker", action="store_true")
    ap.add_argument("--tunnel", metavar="URL", help="also serve the API at this ngrok address")
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
    if args.tunnel:
        commands["tunnel"] = ["ngrok", "http", f"127.0.0.1:{args.port}", "--url", args.tunnel,
                              "--log", "stdout", "--log-level", "warn"]

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    procs: dict[str, subprocess.Popen[bytes]] = {}
    for name, cmd in commands.items():
        procs[name] = subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, creationflags=POPEN_FLAGS)
        threading.Thread(target=_pump, args=(name, procs[name]), daemon=True).start()
    print(f"[dev] API http://0.0.0.0:{args.port}  (Ctrl+C stops everything)", flush=True)
    if args.tunnel:
        print(f"[dev] tunnel {args.tunnel} -> port {args.port}", flush=True)

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
        stop_all(procs)
    return code


if __name__ == "__main__":
    sys.exit(main())
