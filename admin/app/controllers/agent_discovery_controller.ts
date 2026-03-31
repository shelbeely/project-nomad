import { LlmService } from '#services/llm_service'
import { SystemService } from '#services/system_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { NOMAD_MCP_TOOLS } from '../mcp/tools.js'
import { NOMAD_SKILLS, generateSkillsMd } from '../mcp/skills.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AgentDiscoveryController
 *
 * Serves all agent ecosystem discovery endpoints so that any AI framework
 * can find and use NOMAD's capabilities without prior knowledge:
 *
 *  GET /.well-known/agents.json   — A2A-compatible agent card
 *  GET /.well-known/mcp.json      — MCP server info
 *  GET /.well-known/ai-plugin.json — OpenAI plugin manifest
 *  GET /openapi.json              — Minimal OpenAPI 3.1 spec for agent routes
 *  GET /agents.md                 — Human + machine readable codebase description
 *  GET /skills.md                 — skills.md skills manifest
 *  GET /api/agent/tools           — OpenAI-format tool list (for LangChain and other frameworks)
 */
@inject()
export default class AgentDiscoveryController {
  constructor(
    private systemService: SystemService,
    private llmService: LlmService
  ) {}

  private _baseUrl(): string {
    return env.get('URL') ?? 'http://localhost:8080'
  }

  private async _version(): Promise<string> {
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'version.json'), 'utf-8'))
      return pkg.version ?? '1.0.0'
    } catch {
      return '1.0.0'
    }
  }

  // ─── /.well-known/agents.json — A2A Agent Card ────────────────────────────

  async agentCard({ response }: HttpContext) {
    const base = this._baseUrl()
    const version = await this._version()
    const services = await this.systemService.getServices({ installedOnly: true })

    const card = {
      name: 'Project N.O.M.A.D.',
      description:
        'Offline-first AI-agent infrastructure. Semantic knowledge search, local LLM chat (RAG), offline Wikipedia, Internet Archive mirror, maps, and system orchestration — all fully operable by an AI agent.',
      url: base,
      version,
      provider: { organization: 'Crosstalk Solutions', url: 'https://projectnomad.us' },

      // Capability flags (Google A2A / emerging standard)
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
        multiModal: false,
        offlineFirst: true,
        ragSupported: true,
      },

      defaultInputModes: ['text'],
      defaultOutputModes: ['text', 'json'],

      // Authentication
      authentication: {
        type: env.get('NOMAD_API_KEY') ? 'api_key' : 'none',
        required: !!env.get('NOMAD_API_KEY'),
        schemes: ['X-NOMAD-Key', 'Bearer'],
      },

      // Active AI provider
      llmProvider: this.llmService.provider,
      installedServices: services.map((s) => s.service_name),

      // API endpoints
      endpoints: {
        mcp_jsonrpc: `${base}/mcp`,
        mcp_tools_list: `${base}/mcp/tools`,
        mcp_call: `${base}/mcp/call`,
        openai_completions: `${base}/v1/chat/completions`,
        openai_models: `${base}/v1/models`,
        openai_tools: `${base}/api/agent/tools`,
        agent_status: `${base}/api/agent/status`,
        agent_setup: `${base}/api/agent/setup`,
        openapi_spec: `${base}/openapi.json`,
        skills_manifest: `${base}/skills.md`,
        agents_md: `${base}/agents.md`,
      },

      // Skill summary
      skills: NOMAD_SKILLS.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        mcpTool: s.mcpTool ?? null,
      })),
    }

    return response.header('Content-Type', 'application/json').json(card)
  }

  // ─── /.well-known/mcp.json — MCP Server Info ─────────────────────────────

  mcpInfo({ response }: HttpContext) {
    const base = this._baseUrl()
    return response.header('Content-Type', 'application/json').json({
      name: 'project-nomad',
      version: '2024-11-05',
      description: 'Project N.O.M.A.D. MCP server — offline knowledge & AI tools',
      transport: ['http'],
      endpoint: `${base}/mcp`,
      tools_endpoint: `${base}/mcp/tools`,
      authentication: env.get('NOMAD_API_KEY')
        ? { type: 'api_key', header: 'X-NOMAD-Key' }
        : { type: 'none' },
    })
  }

  // ─── /.well-known/ai-plugin.json — OpenAI Plugin Manifest ─────────────────

  aiPlugin({ response }: HttpContext) {
    const base = this._baseUrl()
    return response.header('Content-Type', 'application/json').json({
      schema_version: 'v1',
      name_for_human: 'Project N.O.M.A.D.',
      name_for_model: 'project_nomad',
      description_for_human:
        'Offline-first AI knowledge base: Wikipedia, Internet Archive, semantic search, local LLM, maps, and more.',
      description_for_model:
        'Project NOMAD provides offline knowledge retrieval and AI inference tools. Use nomad_search_knowledge for semantic RAG search, nomad_search_wikipedia for offline Wikipedia, nomad_search_internet_archive for the local IA mirror, and nomad_chat for LLM conversation with context injection. System management tools are also available.',
      auth: {
        type: env.get('NOMAD_API_KEY') ? 'user_http' : 'none',
        ...(env.get('NOMAD_API_KEY') ? { authorization_type: 'bearer' } : {}),
      },
      api: {
        type: 'openapi',
        url: `${base}/openapi.json`,
      },
      logo_url: `${base}/project_nomad_logo.png`,
      contact_email: 'contact@projectnomad.us',
      legal_info_url: 'https://projectnomad.us',
    })
  }

  // ─── /openapi.json — Minimal OpenAPI 3.1 spec ─────────────────────────────

  openApiSpec({ response }: HttpContext) {
    const base = this._baseUrl()
    const spec = {
      openapi: '3.1.0',
      info: {
        title: 'Project N.O.M.A.D. API',
        description: 'Offline AI-agent-first knowledge infrastructure',
        version: '1.0.0',
        contact: { url: 'https://projectnomad.us' },
      },
      servers: [{ url: base, description: 'NOMAD instance' }],
      paths: {
        '/api/agent/status': {
          get: {
            operationId: 'agentStatus',
            summary: 'Full system status snapshot',
            tags: ['agent'],
            responses: {
              '200': { description: 'System status including services, models, downloads, disk' },
            },
          },
        },
        '/api/agent/setup': {
          post: {
            operationId: 'agentSetup',
            summary: 'Headless system setup',
            tags: ['agent'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      services: { type: 'array', items: { type: 'string' } },
                      wikipedia_tier_id: { type: 'string' },
                      ollama_models: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'Setup results' } },
          },
        },
        '/api/agent/tools': {
          get: {
            operationId: 'listToolsOpenAI',
            summary: 'List tools in OpenAI function-calling format',
            tags: ['agent'],
            responses: { '200': { description: 'Array of OpenAI tool definitions' } },
          },
        },
        '/mcp': {
          post: {
            operationId: 'mcpJsonRpc',
            summary: 'MCP JSON-RPC 2.0 endpoint',
            tags: ['mcp'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['jsonrpc', 'method'],
                    properties: {
                      jsonrpc: { type: 'string', enum: ['2.0'] },
                      id: { type: ['string', 'integer', 'null'] },
                      method: {
                        type: 'string',
                        enum: ['initialize', 'tools/list', 'tools/call', 'notifications/initialized'],
                      },
                      params: { type: 'object' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'JSON-RPC 2.0 response' } },
          },
        },
        '/mcp/tools': {
          get: {
            operationId: 'mcpToolsList',
            summary: 'List MCP tool definitions',
            tags: ['mcp'],
            responses: { '200': { description: 'MCP tools array' } },
          },
        },
        '/mcp/call': {
          post: {
            operationId: 'mcpCall',
            summary: 'Execute an MCP tool (REST convenience)',
            tags: ['mcp'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                      arguments: { type: 'object' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'Tool result' } },
          },
        },
        '/v1/models': {
          get: {
            operationId: 'listModelsOpenAI',
            summary: 'List available models (OpenAI format)',
            tags: ['openai-compat'],
            responses: { '200': { description: 'OpenAI model list' } },
          },
        },
        '/v1/chat/completions': {
          post: {
            operationId: 'chatCompletions',
            summary: 'Chat completions (OpenAI format, streaming supported)',
            tags: ['openai-compat'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['model', 'messages'],
                    properties: {
                      model: { type: 'string' },
                      messages: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                            content: { type: 'string' },
                          },
                        },
                      },
                      stream: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'Chat completion' } },
          },
        },
      },
      components: {
        securitySchemes: {
          ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-NOMAD-Key' },
          BearerToken: { type: 'http', scheme: 'bearer' },
        },
      },
    }

    return response.header('Content-Type', 'application/json').json(spec)
  }

  // ─── /agents.md — Serve AGENTS.md ─────────────────────────────────────────

  async agentsMd({ response }: HttpContext) {
    try {
      const content = readFileSync(
        join(process.cwd(), '..', 'AGENTS.md'),
        'utf-8'
      )
      return response.header('Content-Type', 'text/markdown; charset=utf-8').send(content)
    } catch {
      return response.status(404).send('AGENTS.md not found')
    }
  }

  // ─── /skills.md — Generated skills manifest ───────────────────────────────

  skillsMd({ response }: HttpContext) {
    const content = generateSkillsMd(this._baseUrl())
    return response.header('Content-Type', 'text/markdown; charset=utf-8').send(content)
  }

  // ─── /api/agent/tools — OpenAI-format tool list ───────────────────────────

  agentTools({ response }: HttpContext) {
    const tools = NOMAD_MCP_TOOLS.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))
    return response.json(tools)
  }
}
