import { DockerService } from '#services/docker_service'
import { DownloadService } from '#services/download_service'
import { IaMirrorService } from '#services/ia_mirror_service'
import { LlmService } from '#services/llm_service'
import { OllamaService } from '#services/ollama_service'
import { RagService } from '#services/rag_service'
import { SystemService } from '#services/system_service'
import { ZimService } from '#services/zim_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { NOMAD_MCP_TOOLS } from '../mcp/tools.js'
import { SYSTEM_PROMPTS } from '../../constants/ollama.js'
import { MapService } from '#services/map_service'


type McpContent = { type: 'text'; text: string }
type McpResult = { content: McpContent[]; isError?: boolean }

function ok(data: unknown): McpResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function err(message: string): McpResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

// JSON-RPC 2.0 helpers
function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } }
}

@inject()
export default class McpController {
  constructor(
    private systemService: SystemService,
    private dockerService: DockerService,
    private ollamaService: OllamaService,
    private llmService: LlmService,
    private ragService: RagService,
    private zimService: ZimService,
    private mapService: MapService,
    private downloadService: DownloadService,
    private iaMirrorService: IaMirrorService
  ) {}

  /** GET /mcp/tools — return all registered tool definitions (REST convenience) */
  tools(_ctx: HttpContext) {
    return { tools: NOMAD_MCP_TOOLS }
  }

  /**
   * POST /mcp — full MCP JSON-RPC 2.0 endpoint.
   *
   * Handles the MCP protocol lifecycle:
   *   initialize            → server info + capability negotiation
   *   tools/list            → list all available tools
   *   tools/call            → execute a named tool
   *   notifications/initialized → client ready notification (no response)
   *
   * Also accepts a simplified REST envelope { name, arguments } for
   * backwards-compat with the original POST /mcp/call route.
   */
  async jsonRpc({ request, response }: HttpContext) {
    const body = request.body() as Record<string, unknown>

    // ── Simple REST envelope (backwards compat) ──────────────────────────────
    // { name: "...", arguments: {...} }  — not a JSON-RPC call
    if (body?.name && body?.jsonrpc === undefined) {
      return this._handleRestCall(body, response)
    }

    // ── JSON-RPC 2.0 envelope ────────────────────────────────────────────────
    if (body?.jsonrpc !== '2.0') {
      return response.status(400).json(jsonRpcError(null, -32600, 'Invalid Request: jsonrpc must be "2.0"'))
    }

    const id = body.id ?? null
    const method = body.method as string | undefined
    const params = (body.params ?? {}) as Record<string, unknown>

    if (!method) {
      return response.json(jsonRpcError(id, -32600, 'Invalid Request: method is required'))
    }

    logger.info(`[McpController] JSON-RPC method: ${method}`)

    try {
      switch (method) {
        // ── Protocol handshake ──────────────────────────────────────────────
        case 'initialize': {
          const clientVersion = (params.protocolVersion as string) ?? 'unknown'
          logger.info(`[McpController] MCP client initializing, protocol: ${clientVersion}`)
          return response.json(
            jsonRpcResult(id, {
              protocolVersion: '2024-11-05',
              capabilities: { tools: { listChanged: false } },
              serverInfo: {
                name: 'project-nomad',
                version: '1.0.0',
                description: 'Project N.O.M.A.D. — offline AI-agent knowledge infrastructure',
              },
              instructions:
                'Use tools/list to discover available NOMAD tools and tools/call to execute them. ' +
                'All tools work fully offline after initial setup.',
            })
          )
        }

        // ── Notification (no response) ─────────────────────────────────────
        case 'notifications/initialized':
          return response.status(204).send('')

        // ── Tool list ──────────────────────────────────────────────────────
        case 'tools/list':
          return response.json(jsonRpcResult(id, { tools: NOMAD_MCP_TOOLS }))

        // ── Tool call ──────────────────────────────────────────────────────
        case 'tools/call': {
          const name = params.name as string | undefined
          const args = (params.arguments ?? {}) as Record<string, unknown>
          if (!name) {
            return response.json(jsonRpcError(id, -32602, 'Invalid params: name is required'))
          }
          const toolResult = await this._dispatch(name, args)
          return response.json(jsonRpcResult(id, toolResult))
        }

        default:
          return response.json(jsonRpcError(id, -32601, `Method not found: ${method}`))
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`[McpController] JSON-RPC error for method "${method}": ${msg}`)
      return response.json(jsonRpcError(id, -32603, 'Internal error', msg))
    }
  }

  /** POST /mcp/call — execute a tool by name (REST convenience) */
  async call({ request, response }: HttpContext) {
    return this._handleRestCall(request.body(), response)
  }

  private async _handleRestCall(body: Record<string, unknown>, response: HttpContext['response']) {
    const name = body?.name as string | undefined
    const args: Record<string, unknown> = (body?.arguments as Record<string, unknown>) ?? {}

    if (!name) {
      return response.status(400).json(err('Missing required field: name'))
    }

    logger.info(`[McpController] REST tool call: ${name}`)

    try {
      const result = await this._dispatch(name, args)
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`[McpController] tool "${name}" failed: ${msg}`)
      return err(`Tool "${name}" failed: ${msg}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatcher (also callable by AgentController for the agentic loop)
  // ---------------------------------------------------------------------------

  /**
   * Execute a named NOMAD tool and return its raw result (not wrapped in MCP
   * content format). Used by the agentic loop in AgentController so it can
   * feed results back to the LLM as plain values.
   */
  async executeToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this._dispatch(name, args)
    if (result.isError) {
      throw new Error(result.content[0]?.text ?? `Tool "${name}" failed`)
    }
    try {
      return JSON.parse(result.content[0]?.text ?? 'null')
    } catch {
      return result.content[0]?.text ?? null
    }
  }

  private async _dispatch(name: string, args: Record<string, unknown>): Promise<McpResult> {
    switch (name) {
      // ─── System ────────────────────────────────────────────────────────────
      case 'nomad_health':
        return this._toolHealth()
      case 'nomad_list_services':
        return this._toolListServices()
      case 'nomad_install_service':
        return this._toolInstallService(args)
      case 'nomad_control_service':
        return this._toolControlService(args)

      // ─── Knowledge ─────────────────────────────────────────────────────────
      case 'nomad_search_knowledge':
        return this._toolSearchKnowledge(args)
      case 'nomad_search_wikipedia':
        return this._toolSearchWikipedia(args)

      // ─── AI ────────────────────────────────────────────────────────────────
      case 'nomad_chat':
        return this._toolChat(args)
      case 'nomad_list_models':
        return this._toolListModels()
      case 'nomad_download_model':
        return this._toolDownloadModel(args)

      // ─── Maps ──────────────────────────────────────────────────────────────
      case 'nomad_list_map_regions':
        return this._toolListMapRegions()

      // ─── Internet Archive ──────────────────────────────────────────────────
      case 'nomad_search_internet_archive':
        return this._toolSearchIA(args)
      case 'nomad_get_ia_item':
        return this._toolGetIaItem(args)

      // ─── Observability ─────────────────────────────────────────────────────
      case 'nomad_storage_status':
        return this._toolStorageStatus()
      case 'nomad_download_status':
        return this._toolDownloadStatus()

      default:
        return err(`Unknown tool: "${name}". Call GET /mcp/tools to see available tools.`)
    }
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  private async _toolHealth(): Promise<McpResult> {
    const [services, internet] = await Promise.all([
      this.systemService.getServices({ installedOnly: true }),
      this.systemService.getInternetStatus(),
    ])
    return ok({
      status: 'ok',
      provider: this.llmService.provider,
      internet,
      services: services.map((s) => ({
        name: s.service_name,
        friendly_name: s.friendly_name,
        installed: s.installed,
        installation_status: s.installation_status,
      })),
    })
  }

  private async _toolListServices(): Promise<McpResult> {
    const services = await this.systemService.getServices({ installedOnly: false })
    return ok(
      services.map((s) => ({
        service_name: s.service_name,
        friendly_name: s.friendly_name,
        description: s.description,
        installed: s.installed,
        installation_status: s.installation_status,
        ui_location: s.ui_location,
        powered_by: s.powered_by,
        source_repo: s.source_repo,
      }))
    )
  }

  private async _toolInstallService(args: Record<string, unknown>): Promise<McpResult> {
    const serviceName = args.service_name as string | undefined
    if (!serviceName) return err('Missing required argument: service_name')

    const result = await this.dockerService.createContainerPreflight(serviceName)
    return result.success ? ok({ success: true, message: result.message }) : err(result.message)
  }

  private async _toolControlService(args: Record<string, unknown>): Promise<McpResult> {
    const serviceName = args.service_name as string | undefined
    const action = args.action as 'start' | 'stop' | 'restart' | undefined
    if (!serviceName) return err('Missing required argument: service_name')
    if (!action || !['start', 'stop', 'restart'].includes(action))
      return err('action must be one of: start, stop, restart')

    const result = await this.dockerService.affectContainer(serviceName, action)
    return result.success ? ok({ success: true, message: result.message }) : err(result.message)
  }

  private async _toolSearchKnowledge(args: Record<string, unknown>): Promise<McpResult> {
    const query = args.query as string | undefined
    if (!query) return err('Missing required argument: query')

    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 20) : 5
    const minScore = typeof args.min_score === 'number' ? args.min_score : 0.3

    const results = await this.ragService.searchSimilarDocuments(query, limit, minScore)
    return ok(
      results.map((r) => ({
        text: r.text,
        source: r.metadata?.source ?? null,
        score: r.score,
      }))
    )
  }

  private async _toolSearchWikipedia(args: Record<string, unknown>): Promise<McpResult> {
    const query = args.query as string | undefined
    if (!query) return err('Missing required argument: query')

    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 20) : 5
    const results = await this.zimService.searchArticles(query, limit)
    return ok(results)
  }

  private async _toolChat(args: Record<string, unknown>): Promise<McpResult> {
    const message = args.message as string | undefined
    if (!message) return err('Missing required argument: message')

    const systemPrompt =
      typeof args.system_prompt === 'string' ? args.system_prompt : SYSTEM_PROMPTS.default
    const useRag = args.use_rag !== false

    const messages: { role: 'system' | 'user'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Optionally inject RAG context
    if (useRag) {
      try {
        const ragResults = await this.ragService.searchSimilarDocuments(message, 3, 0.35)
        if (ragResults.length > 0) {
          const contextText = ragResults
            .map((r, i) => `[Context ${i + 1}]\n${r.text}`)
            .join('\n\n')
          messages.push({ role: 'system', content: SYSTEM_PROMPTS.rag_context(contextText) })
        }
      } catch {
        // RAG unavailable — continue without context
      }
    }

    messages.push({ role: 'user', content: message })

    const installedModels = await this.llmService.getInstalledModels()
    const model =
      typeof args.model === 'string' && args.model
        ? args.model
        : installedModels?.[0]?.name ?? 'llama3.2:3b'

    const result = await this.llmService.chat({ model, messages })
    return ok({ response: result.message.content, model })
  }

  private async _toolListModels(): Promise<McpResult> {
    const models = await this.llmService.getInstalledModels()
    return ok(models ?? [])
  }

  private async _toolDownloadModel(args: Record<string, unknown>): Promise<McpResult> {
    const modelName = args.model_name as string | undefined
    if (!modelName) return err('Missing required argument: model_name')
    const result = await this.ollamaService.dispatchModelDownload(modelName)
    return result.success ? ok({ success: true, message: result.message }) : err(result.message)
  }

  private async _toolListMapRegions(): Promise<McpResult> {
    const { files } = await this.mapService.listRegions()
    return ok(files)
  }

  private async _toolSearchIA(args: Record<string, unknown>): Promise<McpResult> {
    const query = args.query as string | undefined
    if (!query) return err('Missing required argument: query')

    const rows = typeof args.rows === 'number' ? Math.min(args.rows, 50) : 10
    const mediaType = typeof args.media_type === 'string' ? args.media_type : undefined

    const results = await this.iaMirrorService.search(query, rows, mediaType)
    return ok(results)
  }

  private async _toolGetIaItem(args: Record<string, unknown>): Promise<McpResult> {
    const identifier = args.identifier as string | undefined
    if (!identifier) return err('Missing required argument: identifier')
    const item = await this.iaMirrorService.getItem(identifier)
    return ok(item)
  }

  private async _toolStorageStatus(): Promise<McpResult> {
    const info = await this.systemService.getSystemInfo()
    return ok({ disk: info?.disk ?? null, fsSize: info?.fsSize ?? null })
  }

  private async _toolDownloadStatus(): Promise<McpResult> {
    const jobs = await this.downloadService.listDownloadJobs()
    return ok(jobs)
  }
}
