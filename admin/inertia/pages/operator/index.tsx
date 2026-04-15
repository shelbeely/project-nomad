import { Head } from '@inertiajs/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTransmit } from 'react-adonis-transmit'
import axios from 'axios'
import OperatorLayout from '~/layouts/OperatorLayout'
import PlanPanel from '~/components/operator/PlanPanel'
import ActivityTimeline from '~/components/operator/ActivityTimeline'
import ArtifactsPanel from '~/components/operator/ArtifactsPanel'
import SystemStatusPanel from '~/components/operator/SystemStatusPanel'
import ApprovalBanner from '~/components/operator/ApprovalBanner'
import TaskHistoryList from '~/components/operator/TaskHistoryList'
import ReactMarkdown from 'react-markdown'
import {
  IconBolt,
  IconSend,
  IconLoader2,
  IconX,
  IconRefresh,
  IconRobot,
  IconTools,
} from '@tabler/icons-react'
import { operatorTaskChannel } from '../../../constants/broadcast'

import type { ActivityEvent } from '~/components/operator/ActivityTimeline'
import type { LiveStep } from '~/components/operator/PlanPanel'
import type { Artifact } from '~/components/operator/ArtifactsPanel'
import type { OperatorStatus } from '~/components/operator/SystemStatusPanel'
import type { PendingApproval } from '~/components/operator/ApprovalBanner'
import type { TaskSummary } from '~/components/operator/TaskHistoryList'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolInfo {
  name: string
  description: string
}

interface OperatorPageProps {
  operator: {
    status: OperatorStatus
    recentTasks: TaskSummary[]
    tools: ToolInfo[]
  }
}

type TaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'blocked'

interface ActiveTask {
  id: number
  title: string
  goal: string
  status: TaskStatus
  model: string | null
  response: string | null
  finish_reason: string | null
  created_at: string
  max_iterations: number
}

// ── Goal input suggestions ────────────────────────────────────────────────────

const GOAL_SUGGESTIONS = [
  'Check system health and summarize service status',
  'Search offline Wikipedia for water purification methods',
  'List all installed services and their current state',
  'Walk me through setting up NOMAD for the first time',
  'Search local knowledge base for emergency medicine resources',
  'Check storage usage and recommend what to clean up',
  'List available AI models and their capabilities',
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OperatorPage({ operator }: OperatorPageProps) {
  const { subscribe } = useTransmit()

  // ── State ───────────────────────────────────────────────────────────────────
  const [goal, setGoal] = useState('')
  const [selectedModel, setSelectedModel] = useState(operator.status.models[0] ?? '')
  const [maxIterations, setMaxIterations] = useState(10)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [showToolSelector, setShowToolSelector] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [tasks, setTasks] = useState<TaskSummary[]>(operator.recentTasks)
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([])
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])

  const [systemStatus, setSystemStatus] = useState<OperatorStatus>(operator.status)
  const [loadingTask, setLoadingTask] = useState(false)

  const activityEndRef = useRef<HTMLDivElement>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // ── Auto-scroll activity log ────────────────────────────────────────────────
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activityLog])

  // ── Poll system status ──────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get('/api/operator/status')
        setSystemStatus(res.data)
        setPendingApprovals(res.data.pendingApprovalsList ?? [])
      } catch {}
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

  // ── Subscribe to SSE for active task ───────────────────────────────────────
  const subscribeToTask = useCallback(
    (taskId: number) => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      const unsub = subscribe(operatorTaskChannel(taskId), (data: unknown) => {
        const event = data as { type: string } & Record<string, unknown>
        const ts = new Date().toISOString()

        switch (event.type) {
          case 'step_started':
            setLiveSteps((prev) => {
              const exists = prev.find((s) => s.step_id === (event.step_id as number))
              if (exists) return prev
              return [
                ...prev,
                {
                  step_id: event.step_id as number,
                  step_number: event.step_number as number,
                  status: 'running',
                  tool_name: event.tool_name as string,
                  tool_args: (event.tool_args as Record<string, unknown>) ?? {},
                },
              ]
            })
            setActivityLog((prev) => [
              ...prev,
              { type: 'step_started', step_number: event.step_number as number, tool_name: event.tool_name as string, ts },
            ])
            break

          case 'step_done':
            setLiveSteps((prev) =>
              prev.map((s) =>
                s.step_id === (event.step_id as number)
                  ? { ...s, status: 'done', tool_result: event.result }
                  : s
              )
            )
            setActivityLog((prev) => [
              ...prev,
              { type: 'step_done', step_number: event.step_number as number, tool_name: event.tool_name as string, ts },
            ])
            break

          case 'step_failed':
            setLiveSteps((prev) =>
              prev.map((s) =>
                s.step_id === (event.step_id as number)
                  ? { ...s, status: 'failed', error: event.error as string }
                  : s
              )
            )
            setActivityLog((prev) => [
              ...prev,
              { type: 'step_failed', step_number: event.step_number as number, error: event.error as string, ts },
            ])
            break

          case 'thinking':
            setActivityLog((prev) => [...prev, { type: 'thinking', content: event.content as string, ts }])
            break

          case 'response':
            setActiveTask((prev) => (prev ? { ...prev, response: event.content as string } : prev))
            setActivityLog((prev) => [...prev, { type: 'response', content: event.content as string, ts }])
            break

          case 'complete':
            setActiveTask((prev) =>
              prev
                ? { ...prev, status: 'complete', finish_reason: event.finish_reason as string }
                : prev
            )
            setActivityLog((prev) => [
              ...prev,
              { type: 'complete', finish_reason: event.finish_reason as string, iterations: event.iterations as number, ts },
            ])
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'complete' } : t
              )
            )
            break

          case 'failed':
            setActiveTask((prev) => (prev ? { ...prev, status: 'failed' } : prev))
            setActivityLog((prev) => [...prev, { type: 'failed', error: event.error as string, ts }])
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'failed' } : t
              )
            )
            break

          case 'approval_required':
            setActiveTask((prev) => (prev ? { ...prev, status: 'blocked' } : prev))
            setPendingApprovals((prev) => [
              ...prev,
              {
                id: event.approval_id as number,
                task_id: taskId,
                task_title: activeTask?.title ?? 'Task',
                action_type: event.action_type as string,
                action_description: event.description as string,
                created_at: ts,
              },
            ])
            setActivityLog((prev) => [
              ...prev,
              { type: 'approval_required', action_type: event.action_type as string, description: event.description as string, ts },
            ])
            break

          case 'artifact_created':
            setActivityLog((prev) => [
              ...prev,
              { type: 'artifact_created', title: event.title as string, artifact_type: event.artifact_type as string, ts },
            ])
            // Refresh artifacts
            axios.get(`/api/operator/artifacts?task_id=${taskId}`).then((r) => {
              setArtifacts(r.data)
            }).catch(() => {})
            break

          case 'status_update':
            setActivityLog((prev) => [
              ...prev,
              { type: 'status_update', status: event.status as string, message: event.message as string, ts },
            ])
            if (event.status === 'running') {
              setActiveTask((prev) => (prev ? { ...prev, status: 'running' } : prev))
            }
            break
        }
      })

      unsubscribeRef.current = unsub
    },
    [subscribe, activeTask?.title]
  )

  // Clean up subscription on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current()
    }
  }, [])

  // ── Load a task from history ───────────────────────────────────────────────
  const loadTask = useCallback(
    async (taskId: number) => {
      setLoadingTask(true)
      setSelectedTaskId(taskId)
      try {
        const res = await axios.get(`/api/operator/tasks/${taskId}`)
        const data = res.data

        setActiveTask({
          id: data.id,
          title: data.title,
          goal: data.goal,
          status: data.status,
          model: data.model,
          response: data.response,
          finish_reason: data.finish_reason,
          created_at: data.created_at,
          max_iterations: data.max_iterations ?? 10,
        })

        setLiveSteps(
          (data.steps ?? []).map((s: Record<string, unknown>) => ({
            step_id: s.id as number,
            step_number: s.step_number as number,
            status: s.status as LiveStep['status'],
            tool_name: s.tool_name as string,
            tool_args: (s.tool_args as Record<string, unknown>) ?? {},
            tool_result: s.tool_result,
          }))
        )

        setArtifacts(data.artifacts ?? [])
        setActivityLog([])

        // Subscribe to live events if task is still running
        if (data.status === 'running' || data.status === 'blocked') {
          subscribeToTask(taskId)
        }
      } catch (err) {
        console.error('Failed to load task', err)
      } finally {
        setLoadingTask(false)
      }
    },
    [subscribeToTask]
  )

  // ── Submit new task ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const trimmedGoal = goal.trim()
    if (!trimmedGoal || submitting) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const body: Record<string, unknown> = {
        goal: trimmedGoal,
        max_iterations: maxIterations,
      }
      if (selectedModel) body.model = selectedModel
      if (selectedTools.size > 0) body.tools = Array.from(selectedTools)

      const res = await axios.post('/api/operator/tasks', body)
      const created = res.data as { id: number; title: string; status: string; created_at: string }

      const newTask: TaskSummary = {
        id: created.id,
        title: created.title,
        status: 'pending',
        goal: trimmedGoal,
        created_at: created.created_at,
        completed_at: null,
        finish_reason: null,
      }

      setTasks((prev) => [newTask, ...prev])
      setGoal('')
      setSelectedTools(new Set())

      // Switch to new task view
      setActiveTask({
        id: created.id,
        title: created.title,
        goal: trimmedGoal,
        status: 'running',
        model: selectedModel || null,
        response: null,
        finish_reason: null,
        created_at: created.created_at,
        max_iterations: maxIterations,
      })
      setSelectedTaskId(created.id)
      setLiveSteps([])
      setArtifacts([])
      setActivityLog([])

      subscribeToTask(created.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Approval handlers ──────────────────────────────────────────────────────
  const handleApprove = async (id: number) => {
    await axios.post(`/api/operator/approvals/${id}/approve`)
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDeny = async (id: number) => {
    await axios.post(`/api/operator/approvals/${id}/deny`)
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  // ── Cancel task ─────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!activeTask) return
    await axios.delete(`/api/operator/tasks/${activeTask.id}`)
    setActiveTask((prev) => (prev ? { ...prev, status: 'failed' } : prev))
  }

  // ── Refresh status ─────────────────────────────────────────────────────────
  const handleRefreshStatus = async () => {
    try {
      const res = await axios.get('/api/operator/status')
      setSystemStatus(res.data)
      setPendingApprovals(res.data.pendingApprovalsList ?? [])
    } catch {}
  }

  const toggleTool = (name: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  return (
    <OperatorLayout>
      <Head title="AI Operator" />
      <main className="xl:pl-72 flex flex-col flex-1 min-h-screen overflow-hidden">
        <div className="flex flex-col flex-1 p-4 gap-4 max-w-[1600px] w-full mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconBolt size={20} className="text-desert-green" />
              <h1 className="text-lg font-bold text-text-primary">AI Operator</h1>
              <span className="text-xs text-text-secondary px-2 py-0.5 rounded-full bg-surface-primary">
                NOMAD Command Copilot
              </span>
            </div>
            <button
              onClick={handleRefreshStatus}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-desert-green transition-colors"
            >
              <IconRefresh size={15} /> Refresh
            </button>
          </div>

          {/* Approval banners */}
          {pendingApprovals.length > 0 && (
            <ApprovalBanner
              approvals={pendingApprovals}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          )}

          {/* Main grid */}
          <div className="flex flex-1 gap-4 min-h-0 flex-col lg:flex-row">

            {/* ── Left column: Task input + history ── */}
            <div className="flex flex-col gap-4 lg:w-80 xl:w-96 shrink-0">

              {/* Goal input */}
              <div className="rounded-xl bg-surface-primary p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  <IconRobot size={13} /> New Task
                </div>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit()
                  }}
                  rows={4}
                  placeholder="Enter a goal for the NOMAD AI Operator…"
                  className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green resize-y"
                />

                {/* Suggestions */}
                {!goal && (
                  <div className="flex flex-wrap gap-1">
                    {GOAL_SUGGESTIONS.slice(0, 3).map((s) => (
                      <button
                        key={s}
                        onClick={() => setGoal(s)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-surface-secondary text-text-secondary hover:bg-desert-green/10 hover:text-desert-green transition-colors text-left"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Model + iterations */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-text-secondary mb-1">Model</label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full rounded border border-surface-secondary bg-surface-secondary text-text-primary text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-desert-green"
                    >
                      {systemStatus.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {systemStatus.models.length === 0 && (
                        <option value="">No models</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-secondary mb-1">Max steps</label>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Math.max(1, Math.min(25, parseInt(e.target.value) || 10)))}
                      className="w-full rounded border border-surface-secondary bg-surface-secondary text-text-primary text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-desert-green"
                    />
                  </div>
                </div>

                {/* Tool selector */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowToolSelector((o) => !o)}
                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-desert-green transition-colors"
                  >
                    <IconTools size={12} />
                    {selectedTools.size === 0 ? 'All tools' : `${selectedTools.size} tools selected`}
                  </button>
                  {showToolSelector && (
                    <div className="mt-2 grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                      {operator.tools.map((t) => (
                        <label key={t.name} className="flex items-start gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedTools.has(t.name)}
                            onChange={() => toggleTool(t.name)}
                            className="mt-0.5 accent-desert-green"
                          />
                          <span className="text-[10px] font-mono text-text-secondary">{t.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {submitError && (
                  <p className="text-xs text-red-400">{submitError}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting || !goal.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-desert-green text-white px-4 py-2 text-sm font-medium hover:bg-desert-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting
                    ? <><IconLoader2 size={15} className="animate-spin" /> Starting…</>
                    : <><IconSend size={15} /> Run Task</>
                  }
                </button>
              </div>

              {/* Task history */}
              <div className="rounded-xl bg-surface-primary p-4 shadow-sm flex-1 min-h-0">
                <TaskHistoryList
                  tasks={tasks}
                  selectedId={selectedTaskId}
                  onSelect={loadTask}
                  onNew={() => {
                    setActiveTask(null)
                    setSelectedTaskId(null)
                    setLiveSteps([])
                    setActivityLog([])
                    setArtifacts([])
                  }}
                />
              </div>
            </div>

            {/* ── Right area: workspace panels ── */}
            {activeTask ? (
              <div className="flex flex-col flex-1 gap-4 min-w-0">

                {/* Task header */}
                <div className="rounded-xl bg-surface-primary p-3 shadow-sm flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        activeTask.status === 'complete' ? 'bg-desert-green/10 text-desert-green' :
                        activeTask.status === 'running' ? 'bg-yellow-500/10 text-yellow-500' :
                        activeTask.status === 'blocked' ? 'bg-orange-500/10 text-orange-400' :
                        activeTask.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                        'bg-surface-secondary text-text-secondary'
                      }`}>
                        {activeTask.status}
                      </span>
                      <h2 className="text-sm font-semibold text-text-primary truncate">{activeTask.title}</h2>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{activeTask.goal}</p>
                  </div>
                  {activeTask.status === 'running' && (
                    <button
                      onClick={handleCancel}
                      className="text-text-secondary hover:text-red-400 transition-colors shrink-0"
                      title="Cancel task"
                    >
                      <IconX size={16} />
                    </button>
                  )}
                </div>

                {/* Main workspace grid */}
                <div className="flex flex-1 gap-4 min-h-0 flex-col xl:flex-row">

                  {/* Left workspace col */}
                  <div className="flex flex-col gap-4 flex-1 min-w-0">

                    {/* Agent response */}
                    {(activeTask.response || activeTask.status === 'running') && (
                      <div className="rounded-xl bg-surface-primary p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <IconRobot size={16} className="text-desert-green" />
                          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Response</h3>
                          {activeTask.status === 'running' && (
                            <IconLoader2 size={13} className="animate-spin text-yellow-400 ml-auto" />
                          )}
                        </div>
                        {activeTask.response ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-text-primary">
                            <ReactMarkdown>{activeTask.response}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-text-secondary italic">Thinking…</p>
                        )}
                      </div>
                    )}

                    {/* Activity Timeline */}
                    <div className="rounded-xl bg-surface-primary p-4 shadow-sm flex-1 min-h-48 flex flex-col">
                      <ActivityTimeline events={activityLog} />
                      <div ref={activityEndRef} />
                    </div>

                    {/* Artifacts */}
                    {artifacts.length > 0 && (
                      <div className="rounded-xl bg-surface-primary p-4 shadow-sm">
                        <ArtifactsPanel artifacts={artifacts} />
                      </div>
                    )}
                  </div>

                  {/* Right workspace col */}
                  <div className="flex flex-col gap-4 xl:w-72 shrink-0">

                    {/* Plan */}
                    <div className="rounded-xl bg-surface-primary p-4 shadow-sm flex-1 min-h-48 flex flex-col">
                      <PlanPanel
                        steps={liveSteps}
                        taskStatus={activeTask.status}
                        maxIterations={activeTask.max_iterations}
                      />
                    </div>

                    {/* System status */}
                    <div className="rounded-xl bg-surface-primary p-4 shadow-sm">
                      <SystemStatusPanel status={systemStatus} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Empty state — no task selected */
              <div className="flex flex-col flex-1 items-center justify-center gap-4 rounded-xl bg-surface-primary shadow-sm p-8 text-center">
                <IconBolt size={40} className="text-desert-green opacity-50" />
                <div>
                  <h2 className="text-base font-semibold text-text-primary">NOMAD AI Operator</h2>
                  <p className="text-sm text-text-secondary mt-1 max-w-sm">
                    Enter a goal to the left, or select a past task to review.
                    The AI Operator can monitor services, search offline knowledge, and guide you through NOMAD workflows.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {GOAL_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setGoal(s)}
                      className="text-xs px-3 py-1.5 rounded-full bg-surface-secondary text-text-secondary hover:bg-desert-green/10 hover:text-desert-green transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* System status in empty state */}
                <div className="mt-4 w-full max-w-sm rounded-xl bg-surface-secondary/40 p-4">
                  <SystemStatusPanel status={systemStatus} />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </OperatorLayout>
  )
}
