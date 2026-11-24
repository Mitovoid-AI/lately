"""Worker entrypoint: `python -m app.worker`. The loop itself lives in loop.py.

Stopping: SIGINT / SIGTERM (Linux), Ctrl+C / Ctrl+Break (Windows, where asyncio
has no add_signal_handler) stop claiming, give running stages a grace period,
then hand the worker's jobs back (loop.run_forever) before the pool closes.
Closing the console window on Windows skips the grace period: Windows ends the
process a few seconds after telling it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket
import sys
import threading
from typing import Any

from ..config import settings
from ..deps import close_pool, init_pool
from .loop import run_forever

_STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM) + (
    (signal.SIGBREAK,) if hasattr(signal, "SIGBREAK") else ())  # Windows Ctrl+Break
_console_handlers: list[Any] = []  # keeps the ctypes callback alive


def _hold_console_close(loop: asyncio.AbstractEventLoop, stop: asyncio.Event,
                        hurry: asyncio.Event, finished: threading.Event
                        ) -> None:  # pragma: no cover — Windows console only
    """Windows ends a console process as soon as its handler returns from a
    close / logoff / shutdown event (and ~5 s after the event at the latest):
    hold the handler while the worker hands its jobs back, with no grace period."""
    import ctypes
    from ctypes import wintypes

    def handler(event: int) -> bool:
        if event not in (2, 5, 6):  # CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT
            return False  # Ctrl+C / Ctrl+Break: the signal handlers take them
        with contextlib.suppress(RuntimeError):  # the loop already closed
            loop.call_soon_threadsafe(hurry.set)
            loop.call_soon_threadsafe(stop.set)
        finished.wait(4.5)
        return True

    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)(handler)
    _console_handlers.append(callback)
    ctypes.windll.kernel32.SetConsoleCtrlHandler(  # type: ignore[attr-defined,unused-ignore]
        callback, True)


def main() -> None:  # pragma: no cover — long-running entrypoint
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    finished = threading.Event()

    async def _amain() -> None:
        s = settings()
        stop = asyncio.Event()
        hurry = asyncio.Event()
        loop = asyncio.get_running_loop()

        def request_stop(*_: object) -> None:
            loop.call_soon_threadsafe(stop.set)

        for sig in _STOP_SIGNALS:
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:  # Windows lacks add_signal_handler
                signal.signal(sig, request_stop)
        if sys.platform == "win32":
            _hold_console_close(loop, stop, hurry, finished)
        db = await init_pool()
        try:
            await run_forever(
                db,
                f"{socket.gethostname()}-{os.getpid()}",
                concurrency=s.worker_concurrency,
                poll_interval=s.worker_poll_interval_seconds,
                stop=stop,
                hurry=hurry,
            )
        finally:
            await close_pool()

    try:
        with contextlib.suppress(KeyboardInterrupt):
            asyncio.run(_amain())
    finally:
        finished.set()


if __name__ == "__main__":
    main()
