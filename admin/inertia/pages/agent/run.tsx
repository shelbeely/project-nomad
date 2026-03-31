import { Head } from '@inertiajs/react'
import { useState } from 'react'
import AgentLayout from '~/layouts/AgentLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import {
  IconRobot,
  IconLoader2,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconAlertCircle,
  IconTools,
  IconSend,
} from '@tabler/icons-react'
import axios from 'axios'

interface AgenticStep {
  iteration: number
  tool_calls: { id: string; type: string; function: { name: string; arguments: Record<string, unknown> } }[]
  tool_results: { tool_call_id: string; name: string; result: unknown }[]
}

interface AgentRunResult {
  success: boolean
  task: string
  model: string
  response: string
  iterations: number
  finish_reason: 'stop' | 'max_iterations'
  trace: AgenticStep[]
}

function TraceStep({ step, index }: { step: AgenticStep; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-surface-primary rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-primary hover:bg-surface-secondary/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary font-mono">Step {index + 1}</span>
          <span className="text-sm text-text-primary font-medium">
            {step.tool_calls.map((tc) => tc.function.name).join(', ')}
          </span>
        </div>
        {open ? <IconChevronDown size={16} className="text-text-secondary" /> : <IconChevronRight size={16} className="text-text-secondary" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 bg-surface-secondary/40">
          {step.tool_calls.map((tc, i) => (
            <div key={tc.id ?? i}>
              <p className="text-xs font-semibold text-text-secondary mb-1">
                🔧 <span className="font-mono text-desert-green">{tc.function.name}</span>
              </p>
              <pre className="text-xs bg-surface-primary rounded p-2 overflow-x-auto text-text-primary">
                {JSON.stringify(tc.function.arguments, null, 2)}
              </pre>
              {step.tool_results.find((r) => r.tool_call_id === tc.id) && (
                <>
                  <p className="text-xs font-semibold text-text-secondary mt-2 mb-1">↩ Result</p>
                  <pre className="text-xs bg-surface-primary rounded p-2 overflow-x-auto text-text-primary max-h-48">
                    {JSON.stringify(step.tool_results.find((r) => r.tool_call_id === tc.id)?.result, null, 2)}
                  </pre>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AgentRunPage(props: {
  agent: {
    provider: 'ollama' | 'openrouter'
    models: { name: string }[]
    tools: { name: string; description: string }[]
  }
}) {
  const [task, setTask] = useState('')
  const [model, setModel] = useState(props.agent.models[0]?.name ?? '')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxIterations, setMaxIterations] = useState(10)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [showToolSelector, setShowToolSelector] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleTool = (name: string) =>
    setSelectedTools((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handleRun = async () => {
    if (!task.trim() || running) return
    setRunning(true)
    setResult(null)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        task: task.trim(),
        max_iterations: maxIterations,
      }
      if (model) body.model = model
      if (systemPrompt.trim()) body.system_prompt = systemPrompt.trim()
      if (selectedTools.size > 0) body.tools = Array.from(selectedTools)

      const res = await axios.post<AgentRunResult>('/api/agent/run', body, { timeout: 120_000 })
      setResult(res.data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
    } finally {
      setRunning(false)
    }
  }

  return (
    <AgentLayout>
      <Head title="Agent Runner" />
      <main className="xl:pl-72 flex flex-col flex-1 min-h-screen">
        <div className="max-w-4xl w-full mx-auto px-6 py-8 flex flex-col gap-8">
          <StyledSectionHeader
            title="Agent Runner"
            description="Give the AI agent a task. It will autonomously call NOMAD tools to complete it."
          />

          {/* Task Form */}
          <div className="rounded-xl bg-surface-primary p-6 shadow-sm space-y-5">
            {/* Task */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Task</label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={3}
                placeholder="e.g. Search for books about emergency medicine in the Internet Archive and summarize what's available..."
                className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green resize-y"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Model */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green"
                >
                  {props.agent.models.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                  {props.agent.models.length === 0 && (
                    <option value="">No models installed</option>
                  )}
                </select>
              </div>
              {/* Max Iterations */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Max Iterations <span className="text-text-secondary font-normal">(safety limit)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, Math.min(25, parseInt(e.target.value) || 10)))}
                  className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green"
                />
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                System Prompt <span className="text-text-secondary font-normal">(optional)</span>
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                placeholder="Leave blank to use the default NOMAD agent system prompt..."
                className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green resize-y"
              />
            </div>

            {/* Tool Selector */}
            <div>
              <button
                type="button"
                onClick={() => setShowToolSelector((o) => !o)}
                className="flex items-center gap-2 text-sm text-text-secondary hover:text-desert-green transition-colors"
              >
                <IconTools size={15} />
                {selectedTools.size === 0 ? 'All tools enabled' : `${selectedTools.size} tool${selectedTools.size !== 1 ? 's' : ''} selected`}
                {showToolSelector ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </button>
              {showToolSelector && (
                <div className="mt-3 grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                  {props.agent.tools.map((t) => (
                    <label key={t.name} className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedTools.has(t.name)}
                        onChange={() => toggleTool(t.name)}
                        className="mt-0.5 accent-desert-green"
                      />
                      <div>
                        <p className="text-xs font-mono text-text-primary group-hover:text-desert-green">{t.name}</p>
                        <p className="text-[11px] text-text-secondary line-clamp-1">{t.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={running || !task.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-desert-green text-white px-5 py-2.5 text-sm font-medium hover:bg-desert-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} />}
              {running ? 'Agent running…' : 'Run Agent'}
            </button>
          </div>

          {/* Running state */}
          {running && (
            <div className="rounded-xl bg-surface-primary p-6 shadow-sm flex items-center gap-4">
              <IconLoader2 size={24} className="animate-spin text-desert-green shrink-0" />
              <div>
                <p className="text-sm font-medium text-text-primary">Agent is working…</p>
                <p className="text-xs text-text-secondary">The agent is calling tools and reasoning. This may take a moment.</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-5 flex items-start gap-3">
              <IconAlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Agent failed</p>
                <p className="text-sm text-red-600 dark:text-red-300 font-mono mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              {/* Meta */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary font-mono">
                <span className={`px-2 py-0.5 rounded-full font-medium ${result.finish_reason === 'stop' ? 'bg-desert-green/10 text-desert-green' : 'bg-yellow-100 text-yellow-700'}`}>
                  {result.finish_reason === 'stop' ? <IconCheck size={12} className="inline mr-1" /> : <IconAlertCircle size={12} className="inline mr-1" />}
                  {result.finish_reason}
                </span>
                <span>{result.iterations} iteration{result.iterations !== 1 ? 's' : ''}</span>
                <span>model: {result.model}</span>
              </div>

              {/* Response */}
              <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <IconRobot size={18} className="text-desert-green" />
                  <h3 className="text-sm font-semibold text-text-primary">Agent Response</h3>
                </div>
                <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{result.response || '(no response text)'}</div>
              </div>

              {/* Trace */}
              {result.trace.length > 0 && (
                <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <IconTools size={16} className="text-text-secondary" />
                    Tool Call Trace ({result.trace.length} step{result.trace.length !== 1 ? 's' : ''})
                  </h3>
                  <div className="space-y-2">
                    {result.trace.map((step, i) => (
                      <TraceStep key={i} step={step} index={i} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </AgentLayout>
  )
}
