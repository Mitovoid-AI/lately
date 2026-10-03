"""Worker entrypoint: `python -m app.worker`. The loop itself lives in loop.py."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket

from ..config import settings
from ..deps import close_pool, init_pool
from .loop import run_forever


def main() -> None:  # pragma: no cover — long-running entrypoint
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    async def _amain() -> None:
        s = settings()
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError):  # Windows lacks add_signal_handler
                loop.add_signal_handler(sig, stop.set)
        db = await init_pool()
        try:
            await run_forever(
                db,
                f"{socket.gethostname()}-{os.getpid()}",
                concurrency=s.worker_concurrency,
                poll_interval=s.worker_poll_interval_seconds,
                stop=stop,
            )
        finally:
            await close_pool()

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_amain())


if __name__ == "__main__":
    main()
