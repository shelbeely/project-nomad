#!/bin/bash

COMPOSE_FILE="/opt/project-nomad/openclaw_compose.yaml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "openclaw_compose.yaml not found at ${COMPOSE_FILE}."
  exit 1
fi

echo "Stopping OpenClaw agent runtime..."
if docker compose -f "$COMPOSE_FILE" stop; then
  echo "✓ OpenClaw stopped."
else
  echo "✗ Failed to stop OpenClaw."
fi
