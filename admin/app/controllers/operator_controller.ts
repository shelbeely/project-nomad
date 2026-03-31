import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { OperatorService } from '#services/operator_service'
import McpController from '#controllers/mcp_controller'
import { LlmService } from '#services/llm_service'
import { NOMAD_MCP_TOOLS } from '../mcp/tools.js'
import OperatorTask from '../models/operator_task.js'
import OperatorApproval from '../models/operator_approval.js'
import type { OperatorArtifactType } from '../models/operator_artifact.js'

const MAX_GOAL_LENGTH = 4000
const DEFAULT_MAX_ITERATIONS = 10
const MAX_ITERATIONS_CEILING = 25

@inject()
export default class OperatorController {
  constructor(
    private operatorService: OperatorService,
    private llmService: LlmService,
    private mcpController: McpController
  ) {}

  // ── Page renders ──────────────────────────────────────────────────────────

  /**
   * GET /operator
   * Render the AI Operator workspace SPA.
   */
  async index({ inertia }: HttpContext) {
    const [status, recentTasks] = await Promise.all([
      this.operatorService.getOperatorStatus(),
      this.operatorService.listTasks(10),
    ])

    return inertia.render('operator/index', {
      operator: {
        status,
        recentTasks: recentTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          goal: t.goal,
          created_at: t.created_at.toISO(),
          completed_at: t.completed_at?.toISO() ?? null,
          finish_reason: t.finish_reason,
          hasPendingApprovals: (t.$extras?.pendingApprovals ?? 0) > 0,
        })),
        tools: NOMAD_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      },
    })
  }

  // ── Task API ──────────────────────────────────────────────────────────────

  /**
   * GET /api/operator/tasks
   * List recent operator tasks.
   */
  async listTasks({ request, response }: HttpContext) {
    const limit = Math.min(parseInt(request.input('limit', '20')) || 20, 100)
    const tasks = await this.operatorService.listTasks(limit)
    return response.json(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        goal: t.goal,
        provider: t.provider,
        model: t.model,
        created_at: t.created_at.toISO(),
        completed_at: t.completed_at?.toISO() ?? null,
        finish_reason: t.finish_reason,
      }))
    )
  }

  /**
   * POST /api/operator/tasks
   * Create and start a new operator task.
   */
  async createTask({ request, response }: HttpContext) {
    const body = request.body() as {
      goal?: string
      title?: string
      model?: string
      max_iterations?: number
      tools?: string[]
    }

    const goal = body.goal?.trim()
    if (!goal) {
      return response.status(400).json({ error: 'Missing required field: goal' })
    }
    if (goal.length > MAX_GOAL_LENGTH) {
      return response.status(400).json({ error: `Goal must be ${MAX_GOAL_LENGTH} characters or fewer` })
    }

    const maxIterations = Math.min(
      typeof body.max_iterations === 'number' ? body.max_iterations : DEFAULT_MAX_ITERATIONS,
      MAX_ITERATIONS_CEILING
    )

    const models = await this.llmService.getInstalledModels()
    const model = body.model ?? models?.[0]?.name ?? null

    const task = await this.operatorService.createTask({
      goal,
      title: body.title,
      model,
      maxIterations,
      toolNames: body.tools,
    })

    // Fire-and-forget: run the agent loop asynchronously
    this.operatorService
      .runTask(task.id, (name, args) => this.mcpController.executeToolCall(name, args), {
        toolNames: body.tools,
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[OperatorController] Unhandled runTask error for #${task.id}: ${msg}`)
      })

    return response.status(201).json({
      id: task.id,
      title: task.title,
      status: task.status,
      created_at: task.created_at.toISO(),
    })
  }

  /**
   * GET /api/operator/tasks/:id
   * Get full task detail including steps, artifacts, and approvals.
   */
  async getTask({ params, response }: HttpContext) {
    const task = await this.operatorService.getTask(parseInt(params.id))
    if (!task) {
      return response.status(404).json({ error: 'Task not found' })
    }

    return response.json({
      id: task.id,
      title: task.title,
      goal: task.goal,
      status: task.status,
      provider: task.provider,
      model: task.model,
      max_iterations: task.max_iterations,
      response: task.response,
      error: task.error,
      finish_reason: task.finish_reason,
      created_at: task.created_at.toISO(),
      completed_at: task.completed_at?.toISO() ?? null,
      steps: task.steps.map((s) => ({
        id: s.id,
        step_number: s.step_number,
        status: s.status,
        tool_name: s.tool_name,
        tool_args: s.tool_args,
        tool_result: s.tool_result,
        created_at: s.created_at.toISO(),
      })),
      artifacts: task.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        content: a.content,
        created_at: a.created_at.toISO(),
      })),
      approvals: task.approvals.map((ap) => ({
        id: ap.id,
        action_type: ap.action_type,
        action_description: ap.action_description,
        status: ap.status,
        created_at: ap.created_at.toISO(),
        resolved_at: ap.resolved_at?.toISO() ?? null,
      })),
    })
  }

  /**
   * DELETE /api/operator/tasks/:id
   * Cancel a running task.
   */
  async cancelTask({ params, response }: HttpContext) {
    await this.operatorService.cancelTask(parseInt(params.id))
    return response.json({ success: true })
  }

  // ── Approval API ──────────────────────────────────────────────────────────

  /**
   * POST /api/operator/approvals/:id/approve
   * Approve a pending safety action.
   */
  async approveAction({ params, response }: HttpContext) {
    const approval = await this.operatorService.resolveApproval(parseInt(params.id), true)
    if (!approval) {
      return response.status(404).json({ error: 'Approval not found or already resolved' })
    }
    return response.json({ success: true, status: approval.status })
  }

  /**
   * POST /api/operator/approvals/:id/deny
   * Deny a pending safety action.
   */
  async denyAction({ params, response }: HttpContext) {
    const approval = await this.operatorService.resolveApproval(parseInt(params.id), false)
    if (!approval) {
      return response.status(404).json({ error: 'Approval not found or already resolved' })
    }
    return response.json({ success: true, status: approval.status })
  }

  // ── Artifact API ──────────────────────────────────────────────────────────

  /**
   * GET /api/operator/artifacts
   * List artifacts (optionally filtered by task_id).
   */
  async listArtifacts({ request, response }: HttpContext) {
    const taskId = request.input('task_id')
    const artifacts = await this.operatorService.listArtifacts(
      taskId ? parseInt(taskId) : undefined
    )
    return response.json(
      artifacts.map((a) => ({
        id: a.id,
        task_id: a.task_id,
        type: a.type,
        title: a.title,
        content: a.content,
        created_at: a.created_at.toISO(),
      }))
    )
  }

  /**
   * POST /api/operator/artifacts
   * Manually create an artifact (e.g. a note).
   */
  async createArtifact({ request, response }: HttpContext) {
    const body = request.body() as {
      task_id?: number
      type?: OperatorArtifactType
      title?: string
      content?: string
    }

    if (!body.task_id || !body.title?.trim() || !body.content?.trim()) {
      return response.status(400).json({ error: 'Missing required fields: task_id, title, content' })
    }

    // Verify task exists
    const task = await OperatorTask.find(body.task_id)
    if (!task) {
      return response.status(404).json({ error: 'Task not found' })
    }

    const artifact = await this.operatorService.createArtifact({
      taskId: body.task_id,
      type: body.type ?? 'note',
      title: body.title.trim(),
      content: body.content.trim(),
    })

    return response.status(201).json({
      id: artifact.id,
      task_id: artifact.task_id,
      type: artifact.type,
      title: artifact.title,
      created_at: artifact.created_at.toISO(),
    })
  }

  /**
   * GET /api/operator/status
   * Operator system status snapshot for dashboard polling.
   */
  async operatorStatus({ response }: HttpContext) {
    const status = await this.operatorService.getOperatorStatus()
    // Also include recent pending approvals
    const pendingApprovals = await OperatorApproval.query()
      .where('status', 'pending')
      .preload('task')
      .orderBy('created_at', 'desc')
      .limit(10)

    return response.json({
      ...status,
      pendingApprovalsList: pendingApprovals.map((ap) => ({
        id: ap.id,
        task_id: ap.task_id,
        task_title: ap.task?.title ?? 'Unknown task',
        action_type: ap.action_type,
        action_description: ap.action_description,
        created_at: ap.created_at.toISO(),
      })),
    })
  }
}
