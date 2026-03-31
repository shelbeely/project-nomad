# AGENTS.md — Project N.O.M.A.D.

> **Node for Offline Media, Archives, and Data**
> Agent configuration and capability manifest for AI systems interacting with this codebase or running NOMAD as an agent tool provider.

---

## What Is NOMAD?

Project N.O.M.A.D. is a self-contained, offline-first knowledge and AI infrastructure server.
It bundles Wikipedia (Kiwix), local AI inference (Ollama + Qdrant RAG), offline maps (ProtoMaps), note-taking (FlatNotes), an education platform (Kolibri), an Internet Archive mirror (dweb-mirror), data tools (CyberChef), and a system benchmark — all managed by a central AdonisJS 6 "Command Center" API running on Docker.

The system is designed to be operated autonomously by an AI agent: every capability is exposed as a callable tool via MCP, OpenAI-compatible REST, and standard JSON APIs.

---

## Agent API Endpoints

| Purpose | Method | Path |
|---|---|---|
| Agent status snapshot | GET | `/api/agent/status` |
| Headless setup | POST | `/api/agent/setup` |
| OpenAI-format tool list | GET | `/api/agent/tools` |
| MCP tool list (REST) | GET | `/mcp/tools` |
| MCP JSON-RPC 2.0 | POST | `/mcp` |
| OpenAI-compat chat | POST | `/v1/chat/completions` |
| OpenAI-compat models | GET | `/v1/models` |
| System health | GET | `/api/health` |
| Agent card (JSON) | GET | `/.well-known/agents.json` |
| MCP server info | GET | `/.well-known/mcp.json` |
| OpenAI plugin manifest | GET | `/.well-known/ai-plugin.json` |
| OpenAPI spec | GET | `/openapi.json` |
| Skills manifest (MD) | GET | `/skills.md` |

### Authentication
Optional. Set `NOMAD_API_KEY` in `.env`. When set, pass via:
- `X-NOMAD-Key: <key>` header, **or**
- `Authorization: Bearer <key>` header

Routes protected when key is configured: `/mcp/*`, `/v1/*`, `/api/agent/*`.

---

## MCP Tool Reference (Quick)

All tools are callable via `POST /mcp` (JSON-RPC 2.0) or `POST /mcp/call` (REST).

| Tool Name | Description |
|---|---|
| `nomad_health` | System health: services, internet, AI provider |
| `nomad_list_services` | All services with install/running state |
| `nomad_install_service` | Install a service by `service_name` |
| `nomad_control_service` | Start / stop / restart a service |
| `nomad_search_knowledge` | Semantic search across the RAG knowledge base |
| `nomad_search_wikipedia` | Search offline Wikipedia (Kiwix) — returns titles + snippets |
| `wiki_open_article` | Fetch full plain-text of a Kiwix article by title |
| `wiki_open_section` | Extract a named section from a Kiwix article |
| `wiki_quote_passages` | Return keyword-matching sentences from local wiki content |
| `wiki_verify_claim` | Verify a factual claim; returns `supported`/`contradicted`/`not_found` + evidence |
| `nomad_chat` | Chat with the local LLM (RAG-augmented) |
| `nomad_list_models` | List available AI models |
| `nomad_download_model` | Queue an Ollama model download |
| `nomad_list_map_regions` | List downloaded offline map regions |
| `nomad_search_internet_archive` | Search the local Internet Archive mirror |
| `nomad_get_ia_item` | Get metadata for an Archive item |
| `nomad_storage_status` | Disk usage by filesystem |
| `nomad_download_status` | Active download job queue |

Full JSON Schema for all tools: `GET /mcp/tools`

---

## Codebase Architecture

```
project-nomad/
├── admin/                      # AdonisJS 6 Command Center (main application)
│   ├── app/
│   │   ├── controllers/        # HTTP request handlers
│   │   │   ├── ollama_controller.ts        # LLM chat (provider-agnostic via LlmService)
│   │   │   ├── mcp_controller.ts           # MCP REST + JSON-RPC 2.0 endpoint
│   │   │   ├── agent_controller.ts         # /api/agent/status + /api/agent/setup
│   │   │   ├── openai_compat_controller.ts # /v1/chat/completions + /v1/models
│   │   │   ├── agent_discovery_controller.ts # /.well-known/* + agents.md + skills.md
│   │   │   ├── system_controller.ts        # Services, updates, system info
│   │   │   ├── rag_controller.ts           # File upload & embedding management
│   │   │   ├── zim_controller.ts           # Wikipedia/Kiwix management + search
│   │   │   ├── maps_controller.ts          # Offline map management
│   │   │   └── ia_mirror_controller.ts     # Internet Archive mirror proxy
│   │   ├── services/
│   │   │   ├── llm_service.ts              # Provider abstraction (Ollama | OpenRouter)
│   │   │   ├── ollama_service.ts           # Local Ollama LLM + model management
│   │   │   ├── rag_service.ts              # Qdrant vector DB + embeddings pipeline
│   │   │   ├── docker_service.ts           # Docker-outside-Docker orchestration
│   │   │   ├── zim_service.ts              # Kiwix library management + article search
│   │   │   ├── ia_mirror_service.ts        # Internet Archive dweb-mirror proxy
│   │   │   ├── map_service.ts              # ProtoMaps tile management
│   │   │   ├── system_service.ts           # System info, services, disk, GPU
│   │   │   └── chat_service.ts             # Chat session persistence
│   │   ├── mcp/
│   │   │   └── tools.ts                    # MCP tool schema definitions
│   │   ├── middleware/
│   │   │   └── api_key_middleware.ts       # Optional NOMAD_API_KEY auth
│   │   ├── models/                         # Lucid ORM models (MySQL)
│   │   └── jobs/                           # BullMQ background jobs (Redis)
│   ├── constants/
│   │   ├── ollama.ts           # System prompts, RAG limits, fallback models
│   │   └── service_names.ts    # Docker service name constants
│   ├── inertia/                # React 19 + Inertia.js frontend
│   └── start/
│       ├── routes.ts           # All HTTP routes
│       ├── env.ts              # Environment variable schema & validation
│       └── kernel.ts           # Middleware registration
├── install/                    # Bash installer + Docker Compose templates
├── collections/                # Curated content manifests (Wikipedia tiers, maps)
└── AGENTS.md                   # This file
```

### Key Import Aliases (package.json)
```
#controllers/*  → app/controllers/
#services/*     → app/services/
#models/*       → app/models/
#middleware/*   → app/middleware/
#jobs/*         → app/jobs/
#mcp/*          → app/mcp/
#start/*        → start/
#validators/*   → app/validators/
```

### Tech Stack
- **Runtime:** Node.js 22, TypeScript 5.8
- **Framework:** AdonisJS 6.18
- **Frontend:** React 19, Inertia.js, Vite, Tailwind CSS
- **Database:** MySQL 8 (Lucid ORM)
- **Queue:** Redis 7 + BullMQ
- **Vector DB:** Qdrant
- **LLM:** Ollama (local) or OpenRouter (cloud, configurable)
- **Orchestration:** Dockerode (Docker-outside-Docker)

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `ollama` | LLM provider: `ollama` or `openrouter` |
| `OPENROUTER_API_KEY` | — | Required when `AI_PROVIDER=openrouter` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL |
| `OPENROUTER_DEFAULT_MODEL` | `openai/gpt-4o-mini` | Default OpenRouter model |
| `NOMAD_API_KEY` | — | Optional API key for agent route auth |
| `NOMAD_STORAGE_PATH` | `/opt/project-nomad/storage` | Host path for persistent storage |
| `APP_KEY` | — | AdonisJS encryption key (16+ chars) |
| `URL` | `http://localhost:8080` | Public access URL |

---

## Agent Interaction Patterns

### 1. Discover capabilities
```http
GET /.well-known/agents.json
GET /mcp/tools
GET /api/agent/tools   # OpenAI-format
```

### 2. Check system state
```http
GET /api/agent/status
```

### 3. Headless setup
```http
POST /api/agent/setup
Content-Type: application/json

{
  "services": ["nomad_kiwix_server", "nomad_ollama", "nomad_qdrant"],
  "wikipedia_tier_id": "openzim_en-mini",
  "ollama_models": ["llama3.2:3b", "nomic-embed-text:v1.5"]
}
```

### 4. MCP tool call (JSON-RPC 2.0)
```http
POST /mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "nomad_search_knowledge",
    "arguments": { "query": "water purification in the field", "limit": 5 }
  }
}
```

### 5. LangChain / AutoGen integration
```python
# Point any OpenAI-compatible client at NOMAD
from openai import OpenAI
client = OpenAI(base_url="http://nomad.local:8080/v1", api_key="none")

# Or load tools directly (works with LangChain, AutoGen, and any OpenAI-compatible framework)
import requests
tools = requests.get("http://nomad.local:8080/api/agent/tools").json()
```

---

## Development Notes

### Running locally
```bash
cd admin
cp .env.example .env   # fill in DB_*, REDIS_*, APP_KEY, URL
npm install
node ace migration:run
node ace db:seed
npm run dev
```

### Adding a new MCP tool
1. Add definition to `admin/app/mcp/tools.ts` (`NOMAD_MCP_TOOLS` array)
2. Add case to `McpController._dispatch()` in `admin/app/controllers/mcp_controller.ts`
3. Implement the handler method (`_toolYourTool()`)

**Wiki tool conventions** (tools backed by `ZimService`): place them between the `nomad_search_wikipedia` case and the `nomad_chat` case in `_dispatch()`, prefixed `wiki_`. The corresponding `ZimService` methods should fetch and parse HTML from the local Kiwix server via `this.dockerService.getServiceURL(SERVICE_NAMES.KIWIX)` and use `cheerio` for HTML parsing.

### Adding a new installable service
1. Add name to `admin/constants/service_names.ts`
2. Add seeder entry to `admin/database/seeders/service_seeder.ts`
3. Create a migration in `admin/database/migrations/` to insert the service row
4. Optionally create a proxy service in `admin/app/services/`

### Testing
```bash
cd admin && node ace test
```
