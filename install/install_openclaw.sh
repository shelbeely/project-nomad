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
header()     { echo -e "\n${GREEN}#########################################################################${RESET}"; }
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
    echo -e "${RED}#${RESET} Docker Compose v2 plugin not found. Install it first."
    exit 1
  fi
  echo -e "${GREEN}#${RESET} Docker and Docker Compose v2 found."
}

check_nomad_network() {
  if ! docker network inspect project-nomad_default &>/dev/null; then
    header_red
    echo -e "${RED}#${RESET} The 'project-nomad_default' Docker network does not exist."
    echo -e "${RED}#${RESET} Start the NOMAD management stack first:"
    echo -e "${RED}#${RESET}   cd ${NOMAD_DIR} && docker compose -f management_compose.yaml up -d"
    exit 1
  fi
  echo -e "${GREEN}#${RESET} NOMAD Docker network found."
}

###############################################################################
#  Token generation
###############################################################################
generate_token() {
  tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w 64 | head -n 1
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
echo -e "${GREEN}#  Deploys OpenClaw as a sibling container on the NOMAD Docker network.${RESET}"
header

# ── Directories ───────────────────────────────────────────────────────────────
echo -e "\n${GREEN}#${RESET} Creating OpenClaw directories in ${OPENCLAW_DIR}..."
sudo mkdir -p "${OPENCLAW_DIR}/config" "${OPENCLAW_DIR}/workspace"

# ── Download compose file ─────────────────────────────────────────────────────
echo -e "${GREEN}#${RESET} Downloading openclaw_compose.yaml..."
sudo curl -fsSL "${OPENCLAW_COMPOSE_URL}" -o "${COMPOSE_FILE}"
if [[ $? -ne 0 ]]; then
  header_red
  echo -e "${RED}#${RESET} Failed to download openclaw_compose.yaml. Check your internet connection."
  exit 1
fi

# ── Gateway token ─────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Enter a gateway token for the OpenClaw dashboard (press Enter to auto-generate):${RESET}"
read -r -p "> " GATEWAY_TOKEN
if [[ -z "$GATEWAY_TOKEN" ]]; then
  GATEWAY_TOKEN=$(generate_token)
  echo -e "  Generated token: ${GATEWAY_TOKEN}"
fi

# ── AI provider selection ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Which AI provider should OpenClaw use?${RESET}"
echo -e "  1) Ollama (default, fully offline — uses NOMAD's local Ollama)"
echo -e "  2) OpenRouter (cloud — requires an API key)"
read -r -p "Enter 1 or 2 [1]: " PROVIDER_CHOICE
PROVIDER_CHOICE="${PROVIDER_CHOICE:-1}"

if [[ "$PROVIDER_CHOICE" == "2" ]]; then
  AI_PROVIDER="openrouter"
  echo ""
  echo -e "${YELLOW}Enter your OpenRouter API key (sk-or-v1-...):${RESET}"
  read -r -p "> " OPENROUTER_KEY
  if [[ -z "$OPENROUTER_KEY" ]]; then
    header_red
    echo -e "${RED}#${RESET} OpenRouter API key is required for OpenRouter provider. Aborting."
    exit 1
  fi

  echo ""
  echo -e "${YELLOW}Enter the default OpenRouter model (e.g. openai/gpt-4o-mini) [openai/gpt-4o-mini]:${RESET}"
  read -r -p "> " DEFAULT_MODEL
  DEFAULT_MODEL="${DEFAULT_MODEL:-openai/gpt-4o-mini}"
  OPENAI_BASE_URL="https://openrouter.ai/api/v1"
  OPENAI_API_KEY="$OPENROUTER_KEY"
else
  AI_PROVIDER="ollama"
  OPENAI_BASE_URL="http://nomad_admin:8080/v1"
  OPENAI_API_KEY="none"
  DEFAULT_MODEL=""

  # Check for NOMAD API key on this host
  # Try to detect NOMAD_API_KEY from the management compose file.
  # The value lives under an `environment:` block, e.g.:
  #   - NOMAD_API_KEY=mysecretkey
  #   - NOMAD_API_KEY="quoted value"
  NOMAD_KEY=""
  if [[ -f "${NOMAD_DIR}/management_compose.yaml" ]]; then
    NOMAD_KEY=$(grep -E '^\s*-?\s*NOMAD_API_KEY=' "${NOMAD_DIR}/management_compose.yaml" \
      | grep -v '^\s*#' | head -1 \
      | sed -E 's/.*NOMAD_API_KEY=//; s/^["'"'"']//; s/["'"'"']$//' | xargs)
  fi
  if [[ -n "$NOMAD_KEY" ]]; then
    echo -e "\n${YELLOW}Detected NOMAD_API_KEY in management_compose.yaml. Using it to authenticate OpenClaw → NOMAD calls.${RESET}"
    OPENAI_API_KEY="$NOMAD_KEY"
  fi
fi

# ── Patch compose file ────────────────────────────────────────────────────────
echo -e "\n${GREEN}#${RESET} Applying configuration..."
sudo sed -i "s|OPENCLAW_GATEWAY_TOKEN=replaceme|OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENCLAW_AI_PROVIDER=ollama|OPENCLAW_AI_PROVIDER=${AI_PROVIDER}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENAI_BASE_URL=http://nomad_admin:8080/v1|OPENAI_BASE_URL=${OPENAI_BASE_URL}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENAI_API_KEY=none|OPENAI_API_KEY=${OPENAI_API_KEY}|" "${COMPOSE_FILE}"

if [[ -n "$DEFAULT_MODEL" ]]; then
  # Uncomment and set the default model line
  sudo sed -i "s|# - OPENCLAW_DEFAULT_MODEL=.*|- OPENCLAW_DEFAULT_MODEL=${DEFAULT_MODEL}|" "${COMPOSE_FILE}"
fi

if [[ -n "$NOMAD_KEY" ]]; then
  # Uncomment and set the MCP token line
  sudo sed -i "s|# - OPENCLAW_MCP_NOMAD_TOKEN=replaceme|- OPENCLAW_MCP_NOMAD_TOKEN=${NOMAD_KEY}|" "${COMPOSE_FILE}"
fi

# ── Pull and start ────────────────────────────────────────────────────────────
echo -e "\n${GREEN}#${RESET} Pulling OpenClaw image..."
docker pull openclaw/gateway:latest

echo -e "\n${GREEN}#${RESET} Starting OpenClaw..."
docker compose -f "${COMPOSE_FILE}" up -d

if [[ $? -ne 0 ]]; then
  header_red
  echo -e "${RED}#${RESET} Failed to start OpenClaw. Check logs:"
  echo -e "    docker compose -f ${COMPOSE_FILE} logs"
  exit 1
fi

# ── Summary ───────────────────────────────────────────────────────────────────
header
echo -e "${GREEN}#  OpenClaw is running!${RESET}"
echo ""
echo -e "  Dashboard : http://localhost:18789  (SSH-tunnel to access remotely)"
echo -e "  Token     : ${GATEWAY_TOKEN}"
echo -e "  Provider  : ${AI_PROVIDER}"
if [[ "$AI_PROVIDER" == "openrouter" ]]; then
  echo -e "  Model     : ${DEFAULT_MODEL}"
  echo -e "  Base URL  : https://openrouter.ai/api/v1"
else
  echo -e "  Base URL  : http://nomad_admin:8080/v1  (NOMAD OpenAI-compat layer)"
fi
echo ""
echo -e "  OpenClaw has access to all NOMAD services over the Docker network:"
echo -e "    MCP tools           → http://nomad_admin:8080/mcp"
echo -e "    Ollama direct       → http://nomad_ollama:11434"
echo -e "    Qdrant              → http://nomad_qdrant:6333"
echo ""
echo -e "  To switch providers later, edit ${COMPOSE_FILE} and run:"
echo -e "    docker compose -f ${COMPOSE_FILE} up -d"
echo ""
echo -e "  Management scripts:"
echo -e "    Start  : sudo bash ${NOMAD_DIR}/start_openclaw.sh"
echo -e "    Stop   : sudo bash ${NOMAD_DIR}/stop_openclaw.sh"
echo -e "    Logs   : docker compose -f ${COMPOSE_FILE} logs -f"
header
