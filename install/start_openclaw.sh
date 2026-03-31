#!/bin/bash

COMPOSE_FILE="/opt/project-nomad/openclaw_compose.yaml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "openclaw_compose.yaml not found at ${COMPOSE_FILE}."
  echo "Run install_openclaw.sh first."
  exit 1
fi

echo "Starting OpenClaw agent runtime..."
if docker compose -f "$COMPOSE_FILE" start; then
  echo "✓ OpenClaw started. Dashboard: http://localhost:18789"
else
  echo "✗ Failed to start OpenClaw. Is the container created? Try:"
  echo "    docker compose -f ${COMPOSE_FILE} up -d"
fi
