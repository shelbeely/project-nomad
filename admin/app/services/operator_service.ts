import { inject } from '@adonisjs/core'
import transmit from '@adonisjs/transmit/services/main'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { LlmService } from './llm_service.js'
import type { LlmMessage, LlmTool } from './llm_service.js'
import { SystemService } from './system_service.js'
import { NOMAD_MCP_TOOLS } from '../mcp/tools.js'
import { operatorTaskChannel } from '../../constants/broadcast.js'
import OperatorTask from '../models/operator_task.js'
import OperatorTaskStep from '../models/operator_task_step.js'
import OperatorArtifact from '../models/operator_artifact.js'
import OperatorApproval from '../models/operator_approval.js'
import type { OperatorApprovalActionType } from '../models/operator_approval.js'
import type { OperatorArtifactType } from '../models/operator_artifact.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for a human approval before timing out and blocking the task. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Event shapes broadcast over SSE
// ---------------------------------------------------------------------------

export type OperatorEvent =
  | { type: 'thinking'; content: string }
  | { type: 'step_started'; step_id: number; step_number: number; tool_name: string; tool_args: Record<string, unknown> }
  | { type: 'step_done'; step_id: number; step_number: number; tool_name: string; result: unknown }
  | { type: 'step_failed'; step_id: number; step_number: number; error: string }
  | { type: 'response'; content: string }
  | { type: 'complete'; finish_reason: string; iterations: number }
  | { type: 'failed'; error: string }
  | { type: 'approval_required'; approval_id: number; action_type: string; description: string; payload: Record<string, unknown> | null }
  | { type: 'artifact_created'; artifact_id: number; title: string; artifact_type: string }
  | { type: 'status_update'; status: string; message: string }

// ---------------------------------------------------------------------------
// Approval-gated action types — these require human sign-off
// ---------------------------------------------------------------------------
const APPROVAL_REQUIRED_TOOLS = new Set([
  'nomad_install_service',
])

const DESTRUCTIVE_ACTION_TYPES: Record<string, OperatorApprovalActionType> = {
  nomad_install_service: 'destructive',
}

// ---------------------------------------------------------------------------
// NOMAD Operator system prompt
// ---------------------------------------------------------------------------
const OPERATOR_SYSTEM_PROMPT = `You are an AI command copilot for Project N.O.M.A.D. (Node for Offline Media, Archives, and Data).

Your role is to help the operator:
- Monitor and control NOMAD services and containers
- Search offline knowledge sources (Wikipedia, RAG knowledge base, Internet Archive)
- Set up, configure, and troubleshoot NOMAD components
- Draft notes, summaries, and reports from local data
- Guide through workflows and installation steps

IMPORTANT RULES:
1. Prefer using NOMAD internal tools over any other approach.
2. Always explain what you are doing before calling a tool.
3. When you have retrieved enough information, provide a clear, concise answer.
4. Clearly identify the source of information: local NOMAD resources vs. system state vs. live internet.
5. Never make up service names, file paths, or configuration values — use the tools to discover them.
6. If a task requires a destructive action (installing services, changing config), describe what you plan to do before proceeding.

Available tool categories:
- System health and service status (nomad_health, nomad_list_services)
- Service control (nomad_control_service, nomad_install_service)
- Knowledge retrieval (nomad_search_knowledge, nomad_search_wikipedia, wiki_open_article, wiki_verify_claim)
- AI models (nomad_list_models, nomad_download_model)
- Storage and downloads (nomad_storage_status, nomad_download_status)
- Maps (nomad_list_map_regions)
- Internet Archive (nomad_search_internet_archive, nomad_get_ia_item)

Start by understanding the current state of NOMAD before acting. When in doubt, check first.`

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export class OperatorService {
  constructor(
    private llmService: LlmService,
    private systemService: SystemService
  ) {}

  // ── Broadcast helper ──────────────────────────────────────────────────────

  private broadcast(taskId: number, event: OperatorEvent): void {
    try {
      transmit.broadcast(operatorTaskChannel(taskId), event as any)
    } catch (err) {
      logger.warn(`[OperatorService] SSE broadcast failed for task ${taskId}: ${err}`)
    }
  }

  // ── Task CRUD ─────────────────────────────────────────────────────────────

  async listTasks(limit = 20): Promise<OperatorTask[]> {
    return OperatorTask.query()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .preload('approvals', (q) => q.where('status', 'pending'))
  }

  async getTask(id: number): Promise<OperatorTask | null> {
    return OperatorTask.query()
      .where('id', id)
      .preload('steps', (q) => q.orderBy('step_number', 'asc'))
      .preload('artifacts')
      .preload('approvals')
      .first()
  }

  async createTask(opts: {
    goal: string
    title?: string
    model?: string
    maxIterations?: number
    toolNames?: string[]
  }): Promise<OperatorTask> {
    const title = opts.title?.trim() || this._titleFromGoal(opts.goal)
    const task = await OperatorTask.create({
      title,
      goal: opts.goal,
      status: 'pending',
      model: opts.model ?? null,
      provider: this.llmService.provider,
      max_iterations: opts.maxIterations ?? 10,
    })
    logger.info(`[OperatorService] Created task #${task.id}: "${title}"`)
    return task
  }

  async cancelTask(id: number): Promise<void> {
    const task = await OperatorTask.find(id)
    if (!task) return
    if (task.status === 'running') {
      await task.merge({ status: 'failed', error: 'Cancelled by user', finish_reason: 'error', completed_at: DateTime.now() }).save()
      this.broadcast(id, { type: 'failed', error: 'Cancelled by user' })
    }
  }

  // ── Artifact management ───────────────────────────────────────────────────

  async listArtifacts(taskId?: number): Promise<OperatorArtifact[]> {
    const q = OperatorArtifact.query().orderBy('created_at', 'desc')
    if (taskId !== undefined) q.where('task_id', taskId)
    return q
  }

  async createArtifact(opts: {
    taskId: number
    type: OperatorArtifactType
    title: string
    content: string
    metadata?: Record<string, unknown>
  }): Promise<OperatorArtifact> {
    const artifact = await OperatorArtifact.create({
      task_id: opts.taskId,
      type: opts.type,
      title: opts.title,
      content: opts.content,
      metadata: opts.metadata ?? null,
    })
    this.broadcast(opts.taskId, {
      type: 'artifact_created',
      artifact_id: artifact.id,
      title: artifact.title,
      artifact_type: artifact.type,
    })
    return artifact
  }

  // ── Approval management ───────────────────────────────────────────────────

  async resolveApproval(approvalId: number, approved: boolean): Promise<OperatorApproval | null> {
    const approval = await OperatorApproval.find(approvalId)
    if (!approval || approval.status !== 'pending') return null

    await approval.merge({
      status: approved ? 'approved' : 'denied',
      resolved_at: DateTime.now(),
    }).save()

    this.broadcast(approval.task_id, {
      type: 'status_update',
      status: approved ? 'approval_granted' : 'approval_denied',
      message: approved ? 'Action approved — resuming...' : 'Action denied by operator.',
    })

    return approval
  }

  // ── Agentic execution ─────────────────────────────────────────────────────

  /**
   * Run the operator's agentic loop for a given task.
   * This is designed to be called fire-and-forget (no await at call site).
   *
   * The tool executor callback is provided by the caller (OperatorController)
   * so the service doesn't need to import McpController (avoids circular deps).
   */
  async runTask(
    taskId: number,
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    opts: { toolNames?: string[] } = {}
  ): Promise<void> {
    const task = await OperatorTask.find(taskId)
    if (!task) {
      logger.error(`[OperatorService] runTask: task #${taskId} not found`)
      return
    }

    // Mark as running
    await task.merge({ status: 'running' }).save()
    this.broadcast(taskId, { type: 'status_update', status: 'running', message: 'Agent started.' })

    try {
      await this._runAgentLoop(task, toolExecutor, opts.toolNames)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[OperatorService] runTask #${taskId} unhandled error: ${message}`)
      await task.merge({ status: 'failed', error: message, finish_reason: 'error', completed_at: DateTime.now() }).save()
      this.broadcast(taskId, { type: 'failed', error: message })
    }
  }

  // ── Private: agent loop ───────────────────────────────────────────────────

  private async _runAgentLoop(
    task: OperatorTask,
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    toolNames?: string[]
  ): Promise<void> {
    const models = await this.llmService.getInstalledModels()
    const model = task.model ?? models?.[0]?.name ?? 'llama3.2:3b'

    // Build tool list
    const requestedTools = toolNames && toolNames.length > 0 ? new Set(toolNames) : null
    const tools: LlmTool[] = NOMAD_MCP_TOOLS
      .filter((t) => !requestedTools || requestedTools.has(t.name))
      .map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))

    const messages: LlmMessage[] = [
      { role: 'system', content: OPERATOR_SYSTEM_PROMPT },
      { role: 'user', content: task.goal },
    ]

    logger.info(`[OperatorService] Starting agentic loop for task #${task.id} — model: "${model}", max_iterations: ${task.max_iterations}`)

    let iteration = 0

    while (iteration < task.max_iterations) {
      iteration++
      logger.info(`[OperatorService] Task #${task.id} iteration ${iteration}/${task.max_iterations}`)

      const result = await this.llmService.chat({ model, messages, tools, tool_choice: 'auto', stream: false })

      const toolCalls = result.message.tool_calls ?? []

      // No tool calls → model is done
      if (toolCalls.length === 0 || result.done) {
        const response = typeof result.message.content === 'string' ? result.message.content : ''
        await task.merge({
          status: 'complete',
          response,
          finish_reason: 'stop',
          completed_at: DateTime.now(),
        }).save()
        this.broadcast(task.id, { type: 'response', content: response })
        this.broadcast(task.id, { type: 'complete', finish_reason: 'stop', iterations: iteration })
        return
      }

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: typeof result.message.content === 'string' ? result.message.content : '',
        tool_calls: toolCalls,
      })

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name
        const toolArgs = tc.function.arguments

        // Create step record
        const step = await OperatorTaskStep.create({
          task_id: task.id,
          step_number: iteration,
          status: 'running',
          tool_name: toolName,
          tool_args: toolArgs,
        })

        this.broadcast(task.id, {
          type: 'step_started',
          step_id: step.id,
          step_number: iteration,
          tool_name: toolName,
          tool_args: toolArgs,
        })

        // Check if approval is required
        if (APPROVAL_REQUIRED_TOOLS.has(toolName)) {
          const actionType = DESTRUCTIVE_ACTION_TYPES[toolName] ?? 'destructive'
          const approval = await OperatorApproval.create({
            task_id: task.id,
            step_id: step.id,
            action_type: actionType,
            action_description: `Tool "${toolName}" requires approval. Args: ${JSON.stringify(toolArgs)}`,
            action_payload: toolArgs,
            status: 'pending',
          })

          this.broadcast(task.id, {
            type: 'approval_required',
            approval_id: approval.id,
            action_type: actionType,
            description: approval.action_description,
            payload: toolArgs,
          })

          // Block task
          await task.merge({ status: 'blocked' }).save()
          await step.merge({ status: 'pending' }).save()

          // Wait for approval (poll every 2s, up to APPROVAL_TIMEOUT_MS)
          const approved = await this._waitForApproval(approval.id, APPROVAL_TIMEOUT_MS)

          if (!approved) {
            await step.merge({ status: 'failed', tool_result: { denied: true } }).save()
            await task.merge({ status: 'failed', finish_reason: 'blocked', completed_at: DateTime.now() }).save()
            this.broadcast(task.id, { type: 'failed', error: `Approval denied for action: ${toolName}` })
            return
          }

          await task.merge({ status: 'running' }).save()
          await step.merge({ status: 'running' }).save()
        }

        // Execute tool
        let toolResult: unknown
        try {
          toolResult = await toolExecutor(toolName, toolArgs)
          await step.merge({ status: 'done', tool_result: toolResult }).save()
          this.broadcast(task.id, {
            type: 'step_done',
            step_id: step.id,
            step_number: iteration,
            tool_name: toolName,
            result: toolResult,
          })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          toolResult = { error: errMsg }
          await step.merge({ status: 'failed', tool_result: toolResult }).save()
          this.broadcast(task.id, {
            type: 'step_failed',
            step_id: step.id,
            step_number: iteration,
            error: errMsg,
          })
        }

        messages.push({
          role: 'tool',
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          tool_call_id: tc.id,
        })
      }
    }

    // Max iterations reached
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const response = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
    await task.merge({
      status: 'complete',
      response,
      finish_reason: 'max_iterations',
      completed_at: DateTime.now(),
    }).save()
    this.broadcast(task.id, { type: 'response', content: response })
    this.broadcast(task.id, { type: 'complete', finish_reason: 'max_iterations', iterations: iteration })
  }

  // ── Private: helpers ──────────────────────────────────────────────────────

  private _titleFromGoal(goal: string): string {
    const clean = goal.trim().replace(/\s+/g, ' ')
    if (clean.length <= 60) return clean
    return clean.slice(0, 57) + '...'
  }

  /**
   * Poll the approval record until it's resolved or the timeout elapses.
   * Returns true if approved, false if denied or timed out.
   */
  private async _waitForApproval(approvalId: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const approval = await OperatorApproval.find(approvalId)
      if (!approval) return false
      if (approval.status === 'approved') return true
      if (approval.status === 'denied') return false
      await new Promise((r) => setTimeout(r, 2000))
    }
    return false
  }

  // ── Operator status snapshot ─────────────────────────────────────────────

  /**
   * Get a status snapshot for the operator dashboard.
   *
   * Note: OpenClaw is an optional sidecar that calls NOMAD's own agent APIs
   * (POST /v1/chat/completions and POST /mcp).  The Operator UI's built-in
   * agent loop uses the exact same LlmService + MCP tools — they are the
   * same execution path, not alternatives.
   */
  async getOperatorStatus(): Promise<{
    provider: string
    models: string[]
    services: { service_name: string; friendly_name: string | null; installed: boolean; installation_status: string }[]
    pendingApprovals: number
    activeTasks: number
  }> {
    const [models, services, pendingApprovals, activeTasks] = await Promise.allSettled([
      this.llmService.getInstalledModels(),
      this.systemService.getServices({ installedOnly: false }),
      OperatorApproval.query().where('status', 'pending').count('* as total'),
      OperatorTask.query().where('status', 'running').count('* as total'),
    ])

    return {
      provider: this.llmService.provider,
      models: models.status === 'fulfilled' ? (models.value ?? []).map((m) => m.name) : [],
      services:
        services.status === 'fulfilled'
          ? services.value.map((s) => ({
              service_name: s.service_name,
              friendly_name: s.friendly_name,
              installed: s.installed,
              installation_status: s.installation_status,
            }))
          : [],
      pendingApprovals:
        pendingApprovals.status === 'fulfilled'
          ? Number((pendingApprovals.value as any)[0]?.total ?? 0)
          : 0,
      activeTasks:
        activeTasks.status === 'fulfilled'
          ? Number((activeTasks.value as any)[0]?.total ?? 0)
          : 0,
    }
  }
}
