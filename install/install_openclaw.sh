#!/bin/bash

# OpenClaw Agent Runtime — Installation Script
# Deploys OpenClaw as a sibling container to the NOMAD managed-services stack.
#
# Requirements:
#   - Debian/Ubuntu host
#   - Docker Engine 24+ and Docker Compose v2 already installed
#   - Project N.O.M.A.D. management stack running (management_compose.yaml)
#
# ─── Non-interactive / automated usage ───────────────────────────────────────
#
#  Pass --non-interactive (or -y) to skip all prompts.  Every value can be
#  supplied as a CLI flag or as a pre-set environment variable:
#
#  Flag                         Env var                    Default
#  --provider <ollama|openrouter>  OPENCLAW_PROVIDER        ollama
#  --token <string>             OPENCLAW_GATEWAY_TOKEN     (auto-generated)
#  --openrouter-key <key>       OPENCLAW_OPENROUTER_KEY    (required for openrouter)
#  --model <model>              OPENCLAW_DEFAULT_MODEL     openai/gpt-4o-mini (openrouter)
#  --nomad-api-key <key>        NOMAD_API_KEY              (auto-detected from compose)
#  --nomad-dir <path>           NOMAD_INSTALL_DIR          /opt/project-nomad
#
#  Examples:
#
#    # Ollama provider, auto-generated token:
#    sudo bash install_openclaw.sh --non-interactive
#
#    # OpenRouter provider, fully scripted:
#    sudo bash install_openclaw.sh -y \
#      --provider openrouter \
#      --openrouter-key sk-or-v1-... \
#      --model openai/gpt-4o-mini \
#      --token my-dashboard-password
#
#    # Via environment variables (e.g. cloud-init, Ansible):
#    export OPENCLAW_PROVIDER=openrouter
#    export OPENCLAW_OPENROUTER_KEY=sk-or-v1-...
#    sudo -E bash install_openclaw.sh --non-interactive
#
# ─────────────────────────────────────────────────────────────────────────────

###############################################################################
#  Colour helpers
###############################################################################
RESET='\033[0m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'

###############################################################################
#  Defaults (overridden by flags / env vars below)
###############################################################################
NOMAD_DIR="${NOMAD_INSTALL_DIR:-/opt/project-nomad}"
OPENCLAW_COMPOSE_URL="https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/install/openclaw_compose.yaml"
OPENCLAW_DIR="${NOMAD_DIR}/openclaw"
COMPOSE_FILE="${NOMAD_DIR}/openclaw_compose.yaml"

NON_INTERACTIVE=false

# Values that can come from env vars or flags
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
AI_PROVIDER="${OPENCLAW_PROVIDER:-}"
OPENROUTER_KEY="${OPENCLAW_OPENROUTER_KEY:-}"
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-}"
NOMAD_API_KEY_OVERRIDE="${NOMAD_API_KEY:-}"

###############################################################################
#  Argument parsing
###############################################################################
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive|-y)
      NON_INTERACTIVE=true
      shift ;;
    --provider)
      AI_PROVIDER="$2"; shift 2 ;;
    --token)
      GATEWAY_TOKEN="$2"; shift 2 ;;
    --openrouter-key)
      OPENROUTER_KEY="$2"; shift 2 ;;
    --model)
      DEFAULT_MODEL="$2"; shift 2 ;;
    --nomad-api-key)
      NOMAD_API_KEY_OVERRIDE="$2"; shift 2 ;;
    --nomad-dir)
      NOMAD_DIR="$2"
      OPENCLAW_DIR="${NOMAD_DIR}/openclaw"
      COMPOSE_FILE="${NOMAD_DIR}/openclaw_compose.yaml"
      shift 2 ;;
    --help|-h)
      sed -n '/^# ─── Non-interactive/,/^# ───────/p' "$0"
      exit 0 ;;
    *)
      echo -e "${RED}Unknown argument: $1${RESET}" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

###############################################################################
#  Helper functions
###############################################################################
header()     { echo -e "\n${GREEN}#########################################################################${RESET}"; }
header_red() { echo -e "\n${RED}#########################################################################${RESET}"; }

die() { header_red; echo -e "${RED}#${RESET} $*"; exit 1; }

check_bash() {
  [[ -n "$BASH_VERSION" ]] || die "Run with bash: bash $(basename "$0")"
}

check_sudo() {
  sudo -n true 2>/dev/null || die "This script requires sudo. Re-run as: sudo bash $(basename "$0")"
  echo -e "${GREEN}#${RESET} sudo OK."
}

check_debian() {
  [[ -f /etc/debian_version ]] || die "This script requires a Debian/Ubuntu host."
  echo -e "${GREEN}#${RESET} Debian-based OS detected."
}

check_docker() {
  command -v docker &>/dev/null || die "Docker is not installed. Install Docker Engine first."
  docker compose version &>/dev/null || die "Docker Compose v2 plugin not found. Install it first."
  echo -e "${GREEN}#${RESET} Docker and Docker Compose v2 found."
}

check_nomad_network() {
  docker network inspect project-nomad_default &>/dev/null || \
    die "The 'project-nomad_default' Docker network does not exist.\n#  Start the NOMAD management stack first:\n#    cd ${NOMAD_DIR} && docker compose -f management_compose.yaml up -d"
  echo -e "${GREEN}#${RESET} NOMAD Docker network found."
}

generate_token() {
  tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w 64 | head -n 1
}

# Prompt helper — skips and uses default when non-interactive
# Usage: prompt_value "Question text" default_var "fallback"
# Sets the named variable.
ask() {
  local prompt="$1" varname="$2" default="$3"
  if $NON_INTERACTIVE; then
    # Use whatever is already set in the variable, or fall back to default
    [[ -z "${!varname}" ]] && printf -v "$varname" '%s' "$default"
    return
  fi
  echo -e "${YELLOW}${prompt}${RESET}"
  read -r -p "> " _input
  if [[ -z "$_input" ]]; then
    printf -v "$varname" '%s' "${!varname:-$default}"
  else
    printf -v "$varname" '%s' "$_input"
  fi
}

###############################################################################
#  Pre-flight checks
###############################################################################
check_bash
check_sudo
check_debian
check_docker
check_nomad_network

header
echo -e "${GREEN}#  OpenClaw Agent Runtime — Installer${RESET}"
if $NON_INTERACTIVE; then
  echo -e "${GREEN}#  Running in non-interactive mode.${RESET}"
fi
echo -e "${GREEN}#  Deploys OpenClaw as a sibling container on the NOMAD Docker network.${RESET}"
header

###############################################################################
#  Directories
###############################################################################
echo -e "\n${GREEN}#${RESET} Creating OpenClaw directories in ${OPENCLAW_DIR}..."
sudo mkdir -p "${OPENCLAW_DIR}/config" "${OPENCLAW_DIR}/workspace"

###############################################################################
#  Download compose template
###############################################################################
echo -e "${GREEN}#${RESET} Downloading openclaw_compose.yaml..."
sudo curl -fsSL "${OPENCLAW_COMPOSE_URL}" -o "${COMPOSE_FILE}" \
  || die "Failed to download openclaw_compose.yaml. Check your internet connection."

###############################################################################
#  Gateway token
###############################################################################
if [[ -z "$GATEWAY_TOKEN" ]]; then
  if $NON_INTERACTIVE; then
    GATEWAY_TOKEN=$(generate_token)
    echo -e "${GREEN}#${RESET} Auto-generated gateway token."
  else
    ask "Enter a gateway token for the OpenClaw dashboard (press Enter to auto-generate):" GATEWAY_TOKEN ""
    [[ -z "$GATEWAY_TOKEN" ]] && GATEWAY_TOKEN=$(generate_token) && echo -e "  Generated token: ${GATEWAY_TOKEN}"
  fi
fi

###############################################################################
#  AI provider selection
###############################################################################
if [[ -z "$AI_PROVIDER" ]]; then
  if $NON_INTERACTIVE; then
    AI_PROVIDER="ollama"
    echo -e "${GREEN}#${RESET} Defaulting to Ollama provider (non-interactive)."
  else
    echo ""
    echo -e "${YELLOW}Which AI provider should OpenClaw use?${RESET}"
    echo -e "  1) Ollama (default, fully offline — uses NOMAD's local Ollama)"
    echo -e "  2) OpenRouter (cloud — requires an API key)"
    read -r -p "Enter 1 or 2 [1]: " PROVIDER_CHOICE
    [[ "${PROVIDER_CHOICE:-1}" == "2" ]] && AI_PROVIDER="openrouter" || AI_PROVIDER="ollama"
  fi
fi

###############################################################################
#  Provider-specific configuration
###############################################################################
if [[ "$AI_PROVIDER" == "openrouter" ]]; then
  # OpenRouter key
  if [[ -z "$OPENROUTER_KEY" ]]; then
    if $NON_INTERACTIVE; then
      die "OpenRouter provider requires --openrouter-key or OPENCLAW_OPENROUTER_KEY env var."
    fi
    ask "Enter your OpenRouter API key (sk-or-v1-...):" OPENROUTER_KEY ""
    [[ -z "$OPENROUTER_KEY" ]] && die "OpenRouter API key is required."
  fi

  # Default model
  if [[ -z "$DEFAULT_MODEL" ]]; then
    if $NON_INTERACTIVE; then
      DEFAULT_MODEL="openai/gpt-4o-mini"
    else
      ask "Enter the default OpenRouter model [openai/gpt-4o-mini]:" DEFAULT_MODEL "openai/gpt-4o-mini"
    fi
  fi

  OPENAI_BASE_URL="https://openrouter.ai/api/v1"
  OPENAI_API_KEY="$OPENROUTER_KEY"
  NOMAD_KEY=""

else
  # Ollama (default)
  AI_PROVIDER="ollama"
  OPENAI_BASE_URL="http://nomad_admin:8080/v1"
  DEFAULT_MODEL=""

  # Detect or use supplied NOMAD_API_KEY
  NOMAD_KEY="$NOMAD_API_KEY_OVERRIDE"
  if [[ -z "$NOMAD_KEY" && -f "${NOMAD_DIR}/management_compose.yaml" ]]; then
    NOMAD_KEY=$(grep -E '^\s*-?\s*NOMAD_API_KEY=' "${NOMAD_DIR}/management_compose.yaml" \
      | grep -v '^\s*#' | head -1 \
      | sed -E 's/.*NOMAD_API_KEY=//; s/^["'"'"']//; s/["'"'"']$//' | xargs)
  fi

  if [[ -n "$NOMAD_KEY" ]]; then
    echo -e "${GREEN}#${RESET} Detected NOMAD_API_KEY — will authenticate OpenClaw → NOMAD calls."
    OPENAI_API_KEY="$NOMAD_KEY"
  else
    OPENAI_API_KEY="none"
  fi
fi

###############################################################################
#  Patch compose file
###############################################################################
echo -e "\n${GREEN}#${RESET} Applying configuration..."
sudo sed -i "s|OPENCLAW_GATEWAY_TOKEN=replaceme|OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENCLAW_AI_PROVIDER=ollama|OPENCLAW_AI_PROVIDER=${AI_PROVIDER}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENAI_BASE_URL=http://nomad_admin:8080/v1|OPENAI_BASE_URL=${OPENAI_BASE_URL}|" "${COMPOSE_FILE}"
sudo sed -i "s|OPENAI_API_KEY=none|OPENAI_API_KEY=${OPENAI_API_KEY}|" "${COMPOSE_FILE}"

if [[ -n "$DEFAULT_MODEL" ]]; then
  sudo sed -i "s|# - OPENCLAW_DEFAULT_MODEL=.*|- OPENCLAW_DEFAULT_MODEL=${DEFAULT_MODEL}|" "${COMPOSE_FILE}"
fi

if [[ -n "$NOMAD_KEY" ]]; then
  sudo sed -i "s|# - OPENCLAW_MCP_NOMAD_TOKEN=replaceme|- OPENCLAW_MCP_NOMAD_TOKEN=${NOMAD_KEY}|" "${COMPOSE_FILE}"
fi

###############################################################################
#  Pull image and start
###############################################################################
echo -e "\n${GREEN}#${RESET} Pulling OpenClaw image..."
docker pull openclaw/gateway:latest

echo -e "\n${GREEN}#${RESET} Starting OpenClaw..."
docker compose -f "${COMPOSE_FILE}" up -d \
  || die "Failed to start OpenClaw.\n  Check logs: docker compose -f ${COMPOSE_FILE} logs"

###############################################################################
#  Summary
###############################################################################
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
echo -e "    MCP tools     → http://nomad_admin:8080/mcp"
echo -e "    Ollama direct → http://nomad_ollama:11434"
echo -e "    Qdrant        → http://nomad_qdrant:6333"
echo ""
echo -e "  To switch providers later, edit ${COMPOSE_FILE} and run:"
echo -e "    docker compose -f ${COMPOSE_FILE} up -d"
echo ""
echo -e "  Management scripts:"
echo -e "    Start : sudo bash ${NOMAD_DIR}/start_openclaw.sh"
echo -e "    Stop  : sudo bash ${NOMAD_DIR}/stop_openclaw.sh"
echo -e "    Logs  : docker compose -f ${COMPOSE_FILE} logs -f"
header
