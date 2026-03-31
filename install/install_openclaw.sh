#!/bin/bash

# OpenClaw Agent Runtime — Installation Script
# Deploys OpenClaw as a sibling container to the NOMAD managed-services stack.
#
# Requirements:
#   - Debian/Ubuntu host
#   - Docker Engine 24+ and Docker Compose v2 already installed
#   - Project N.O.M.A.D. management stack running (management_compose.yaml)

###############################################################################
#  Colour helpers
###############################################################################
RESET='\033[0m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'

NOMAD_DIR="/opt/project-nomad"
OPENCLAW_COMPOSE_URL="https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/install/openclaw_compose.yaml"
OPENCLAW_DIR="${NOMAD_DIR}/openclaw"
COMPOSE_FILE="${NOMAD_DIR}/openclaw_compose.yaml"

###############################################################################
#  Helper functions
###############################################################################
header() { echo -e "\n${GREEN}#########################################################################${RESET}"; }
header_red() { echo -e "\n${RED}#########################################################################${RESET}"; }

check_sudo() {
  if ! sudo -n true 2>/dev/null; then
    header_red
    echo -e "${RED}#${RESET} This script requires sudo. Re-run as: sudo bash $(basename "$0")"
    exit 1
  fi
  echo -e "${GREEN}#${RESET} sudo OK."
}

check_bash() {
  if [[ -z "$BASH_VERSION" ]]; then
    header_red
    echo -e "${RED}#${RESET} Run with bash: bash $(basename "$0")"
    exit 1
  fi
}

check_debian() {
  if [[ ! -f /etc/debian_version ]]; then
    header_red
    echo -e "${RED}#${RESET} This script requires a Debian/Ubuntu host."
    exit 1
  fi
  echo -e "${GREEN}#${RESET} Debian-based OS detected."
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    header_red
    echo -e "${RED}#${RESET} Docker is not installed. Install Docker Engine first, then re-run this script."
    exit 1
  fi
  if ! docker compose version &>/dev/null; then
    header_red
    echo -e "${RED}#${RESET} Docker Compose v2 plugin not found. Install it first, then re-run this script."
    exit 1
  fi
  echo -e "${GREEN}#${RESET} Docker and Docker Compose v2 found."
}

check_nomad_network() {
  if ! docker network inspect project-nomad_default &>/dev/null; then
    header_red
    echo -e "${RED}#${RESET} The 'project-nomad_default' Docker network does not exist."
    echo -e "${RED}#${RESET} Make sure the NOMAD management stack is running before installing OpenClaw."
    echo -e "${RED}#${RESET} Run: cd ${NOMAD_DIR} && docker compose -f management_compose.yaml up -d"
    exit 1
  fi
  echo -e "${GREEN}#${RESET} NOMAD Docker network found."
}

###############################################################################
#  Prompt helpers
###############################################################################
generate_token() {
  # Generate a 64-char alphanumeric token using /dev/urandom
  tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w 64 | head -n 1
}

prompt_token() {
  local default
  default=$(generate_token)
  echo ""
  echo -e "${YELLOW}Enter a secure gateway token for the OpenClaw dashboard.${RESET}"
  echo -e "Press Enter to auto-generate one (recommended):"
  read -r -p "> " user_token
  if [[ -z "$user_token" ]]; then
    echo "$default"
  else
    echo "$user_token"
  fi
}

prompt_nomad_api_key() {
  echo ""
  echo -e "${YELLOW}If NOMAD_API_KEY is set in your NOMAD environment, enter it here so${RESET}"
  echo -e "${YELLOW}OpenClaw can authenticate to the MCP endpoint. Press Enter to skip:${RESET}"
  read -r -p "> " nomad_key
  echo "$nomad_key"
}

###############################################################################
#  Main
###############################################################################
check_bash
check_sudo
check_debian
check_docker
check_nomad_network

header
echo -e "${GREEN}#  OpenClaw Agent Runtime — Installer${RESET}"
echo -e "${GREEN}#  This will deploy OpenClaw as a sibling container to NOMAD.${RESET}"
header

# Ensure directories exist
echo -e "\n${GREEN}#${RESET} Creating OpenClaw directories in ${OPENCLAW_DIR}..."
sudo mkdir -p "${OPENCLAW_DIR}/config" "${OPENCLAW_DIR}/workspace"

# Download compose file
echo -e "${GREEN}#${RESET} Downloading openclaw_compose.yaml..."
sudo curl -fsSL "${OPENCLAW_COMPOSE_URL}" -o "${COMPOSE_FILE}"
if [[ $? -ne 0 ]]; then
  header_red
  echo -e "${RED}#${RESET} Failed to download openclaw_compose.yaml. Check your internet connection."
  exit 1
fi

# Collect configuration
GATEWAY_TOKEN=$(prompt_token)
NOMAD_API_KEY=$(prompt_nomad_api_key)

# Patch the compose file with user-provided values
echo -e "\n${GREEN}#${RESET} Applying configuration..."
sudo sed -i "s/OPENCLAW_GATEWAY_TOKEN=replaceme/OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}/" "${COMPOSE_FILE}"

if [[ -n "$NOMAD_API_KEY" ]]; then
  # Replace the api key placeholder AND uncomment the MCP token line
  sudo sed -i "s/OPENAI_API_KEY=none/OPENAI_API_KEY=${NOMAD_API_KEY}/" "${COMPOSE_FILE}"
  sudo sed -i "s/# - OPENCLAW_MCP_NOMAD_TOKEN=replaceme/- OPENCLAW_MCP_NOMAD_TOKEN=${NOMAD_API_KEY}/" "${COMPOSE_FILE}"
fi

# Pull image
echo -e "\n${GREEN}#${RESET} Pulling OpenClaw image..."
docker pull openclaw/gateway:latest

# Start the container
echo -e "\n${GREEN}#${RESET} Starting OpenClaw..."
docker compose -f "${COMPOSE_FILE}" up -d

if [[ $? -ne 0 ]]; then
  header_red
  echo -e "${RED}#${RESET} Failed to start OpenClaw. Check logs with:"
  echo -e "    docker compose -f ${COMPOSE_FILE} logs"
  exit 1
fi

header
echo -e "${GREEN}#  OpenClaw is running!${RESET}"
echo ""
echo -e "  Dashboard : http://localhost:18789  (SSH-tunnel to access remotely)"
echo -e "  Token     : ${GATEWAY_TOKEN}"
echo ""
echo -e "  OpenClaw is connected to the NOMAD Docker network and can reach:"
echo -e "    LLM / OpenAI-compat → http://nomad_admin:8080/v1"
echo -e "    MCP tools           → http://nomad_admin:8080/mcp"
echo -e "    Ollama direct       → http://nomad_ollama:11434"
echo -e "    Qdrant              → http://nomad_qdrant:6333"
echo ""
echo -e "  To manage OpenClaw:"
echo -e "    Start  : bash ${NOMAD_DIR}/start_openclaw.sh"
echo -e "    Stop   : bash ${NOMAD_DIR}/stop_openclaw.sh"
echo -e "    Logs   : docker compose -f ${COMPOSE_FILE} logs -f"
header
