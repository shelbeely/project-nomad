import {
  IconCheck,
  IconX,
  IconLoader2,
  IconClock,
  IconAlertTriangle,
  IconTools,
  IconChevronDown,
  IconChevronRight,
  IconListDetails,
} from '@tabler/icons-react'
import { useState } from 'react'

export type TaskStep = {
  id: number
  step_number: number
  status: 'pending' | 'running' | 'done' | 'failed'
  tool_name: string | null
  tool_args: Record<string, unknown> | null
  tool_result: unknown
  created_at: string
}

export type LiveStep = {
  step_id: number
  step_number: number
  status: 'pending' | 'running' | 'done' | 'failed'
  tool_name: string
  tool_args: Record<string, unknown>
  tool_result?: unknown
  error?: string
}

interface PlanPanelProps {
  steps: LiveStep[]
  taskStatus: string
  maxIterations: number
}

function StepStatusIcon({ status }: { status: LiveStep['status'] }) {
  if (status === 'done') return <IconCheck size={14} className="text-desert-green shrink-0" />
  if (status === 'running') return <IconLoader2 size={14} className="animate-spin text-yellow-500 shrink-0" />
  if (status === 'failed') return <IconX size={14} className="text-red-400 shrink-0" />
  return <IconClock size={14} className="text-text-secondary shrink-0" />
}

function StepRow({ step }: { step: LiveStep }) {
  const [open, setOpen] = useState(false)
  const hasDetail = step.tool_args && Object.keys(step.tool_args).length > 0

  return (
    <div className="border border-surface-primary rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-secondary/30 hover:bg-surface-secondary/60 text-left transition-colors"
      >
        <StepStatusIcon status={step.status} />
        <span className="font-mono text-desert-green flex-1 truncate">{step.tool_name}</span>
        <span className="text-text-secondary font-mono shrink-0">#{step.step_number}</span>
        {hasDetail && (
          open
            ? <IconChevronDown size={12} className="text-text-secondary shrink-0" />
            : <IconChevronRight size={12} className="text-text-secondary shrink-0" />
        )}
      </button>
      {open && hasDetail && (
        <div className="px-3 py-2 bg-surface-secondary/10 space-y-1">
          <pre className="overflow-x-auto text-text-secondary whitespace-pre-wrap break-all">
            {JSON.stringify(step.tool_args, null, 2)}
          </pre>
          {step.tool_result !== undefined && (
            <>
              <p className="text-text-secondary font-semibold mt-1">↩ Result</p>
              <pre className="overflow-x-auto text-text-primary whitespace-pre-wrap break-all max-h-32">
                {typeof step.tool_result === 'string'
                  ? step.tool_result
                  : JSON.stringify(step.tool_result, null, 2)}
              </pre>
            </>
          )}
          {step.error && (
            <p className="text-red-400 mt-1">{step.error}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlanPanel({ steps, taskStatus, maxIterations }: PlanPanelProps) {
  const done = steps.filter((s) => s.status === 'done').length
  const failed = steps.filter((s) => s.status === 'failed').length
  const running = steps.filter((s) => s.status === 'running').length

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1">
          <IconTools size={13} /> Execution Plan
        </h2>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          {done > 0 && <span className="text-desert-green">{done} done</span>}
          {running > 0 && <span className="text-yellow-500">{running} running</span>}
          {failed > 0 && <span className="text-red-400">{failed} failed</span>}
          {steps.length > 0 && <span className="text-text-secondary">/ {maxIterations} max</span>}
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-8 text-center">
          {taskStatus === 'running' ? (
            <>
              <IconLoader2 size={24} className="animate-spin text-desert-green mb-2" />
              <p className="text-sm text-text-secondary">Waiting for first step…</p>
            </>
          ) : taskStatus === 'pending' ? (
            <>
              <IconClock size={24} className="text-text-secondary mb-2" />
              <p className="text-sm text-text-secondary">Task is queued.</p>
            </>
          ) : (
            <>
              <IconListDetails size={24} className="text-text-secondary mb-2" />
              <p className="text-sm text-text-secondary">No steps yet.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1">
          {steps.map((step) => (
            <StepRow key={step.step_id} step={step} />
          ))}
          {taskStatus === 'running' && (
            <div className="flex items-center gap-2 text-xs text-text-secondary px-2 py-1">
              <IconLoader2 size={12} className="animate-spin" /> Working…
            </div>
          )}
        </div>
      )}

      {(taskStatus === 'complete' || taskStatus === 'failed') && steps.length > 0 && (
        <div className={`mt-auto flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${taskStatus === 'complete' ? 'bg-desert-green/10 text-desert-green' : 'bg-red-500/10 text-red-400'}`}>
          {taskStatus === 'complete'
            ? <><IconCheck size={12} /> Completed {done} step{done !== 1 ? 's' : ''}</>
            : <><IconAlertTriangle size={12} /> Failed after {steps.length} step{steps.length !== 1 ? 's' : ''}</>
          }
        </div>
      )}
    </div>
  )
}
