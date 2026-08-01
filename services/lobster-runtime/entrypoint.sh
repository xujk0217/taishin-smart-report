#!/bin/sh
set -eu

# Fargate bind volumes are mounted as root. Make only the dedicated temporary
# mount writable, then permanently drop privileges before running Python.
chmod 1777 /tmp
exec setpriv --reuid=planner --regid=planner --init-groups \
  python -m lobster_runtime.worker "$@"
