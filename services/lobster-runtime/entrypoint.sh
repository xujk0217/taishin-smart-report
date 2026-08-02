#!/bin/sh
set -eu

# Fargate bind volumes are mounted as root. Make only the dedicated temporary
# mount writable, then permanently drop privileges before running Python.
chmod 1777 /tmp
if [ "${LOBSTER_RUNTIME_MODE:-planner}" = "presentation" ]; then
  exec setpriv --reuid=planner --regid=planner --init-groups \
    python -m lobster_runtime.presentation_worker "$@"
fi
if [ "${LOBSTER_RUNTIME_MODE:-planner}" = "universal-pipeline" ]; then
  exec setpriv --reuid=planner --regid=planner --init-groups \
    python -m lobster_runtime.universal_presentation_pipeline "$@"
fi
exec setpriv --reuid=planner --regid=planner --init-groups \
  python -m lobster_runtime.worker "$@"
