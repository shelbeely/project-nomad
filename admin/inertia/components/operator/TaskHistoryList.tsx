import {
  IconCheck,
  IconX,
  IconLoader2,
  IconClock,
  IconBolt,
  IconAlertTriangle,
} from '@tabler/icons-react'

export type TaskSummary = {
  id: number
  title: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'blocked'
  goal: string
  created_at: string
  completed_at: string | null
  finish_reason: string | null
  hasPendingApprovals?: boolean
}

function StatusIcon({ status }: { status: TaskSummary['status'] }) {
  if (status === 'complete') return <IconCheck size={13} className="text-desert-green shrink-0" />
  if (status === 'running') return <IconLoader2 size={13} className="animate-spin text-yellow-400 shrink-0" />
  if (status === 'failed') return <IconX size={13} className="text-red-400 shrink-0" />
  if (status === 'blocked') return <IconAlertTriangle size={13} className="text-orange-400 shrink-0" />
  return <IconClock size={13} className="text-text-secondary shrink-0" />
}

interface TaskHistoryListProps {
  tasks: TaskSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onNew: () => void
}

export default function TaskHistoryList({ tasks, selectedId, onSelect, onNew }: TaskHistoryListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">History</h2>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1 text-xs text-desert-green hover:text-desert-green/80 font-medium transition-colors"
        >
          <IconBolt size={12} /> New task
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-text-secondary text-center py-4">No tasks yet. Enter a goal above.</p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto flex-1">
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`w-full flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                selectedId === t.id
                  ? 'bg-desert-green/10 border border-desert-green/30'
                  : 'hover:bg-surface-primary border border-transparent'
              }`}
            >
              <StatusIcon status={t.status} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">{t.title}</p>
                <p className="text-[10px] text-text-secondary">
                  {new Date(t.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {t.hasPendingApprovals && (
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-400 mt-1" title="Needs approval" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
