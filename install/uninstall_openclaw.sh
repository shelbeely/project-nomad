#!/bin/bash

RESET='\033[0m'
GREEN='\033[1;32m'
RED='\033[1;31m'
YELLOW='\033[1;33m'

NOMAD_DIR="/opt/project-nomad"
COMPOSE_FILE="${NOMAD_DIR}/openclaw_compose.yaml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo -e "${YELLOW}#${RESET} openclaw_compose.yaml not found — nothing to uninstall."
  exit 0
fi

echo -e "${YELLOW}#${RESET} This will stop and remove the OpenClaw container and its image."
echo -e "${YELLOW}#${RESET} Your config and workspace data in ${NOMAD_DIR}/openclaw will NOT be deleted."
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo -e "\n${GREEN}#${RESET} Stopping and removing OpenClaw containers..."
docker compose -f "$COMPOSE_FILE" down --rmi local

echo -e "${GREEN}#${RESET} Removing compose file..."
rm -f "$COMPOSE_FILE"

echo -e "\n${GREEN}#${RESET} OpenClaw uninstalled."
echo -e "  Config and workspace data are still in: ${NOMAD_DIR}/openclaw"
echo -e "  Remove manually with: sudo rm -rf ${NOMAD_DIR}/openclaw"
