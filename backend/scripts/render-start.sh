#!/bin/sh
# Start command for Render's free plan (render.yaml). Free Render runs web services only, so
# the worker shares the API's container: it runs in the background and restarts if it exits,
# while the API serves on the port Render gives (PORT, 10000 by default).
# --forwarded-allow-ips: trust Render's proxy, so links the API builds (thumbnails) are https.
(
  while true; do
    python -m app.worker
    echo "worker exited with status $?; restarting in 5 s" >&2
    sleep 5
  done
) &
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --proxy-headers --forwarded-allow-ips='*'
