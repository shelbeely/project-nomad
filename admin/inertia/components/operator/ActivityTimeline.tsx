import {
  IconActivity,
  IconTools,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconBrain,
  IconInfoCircle,
} from '@tabler/icons-react'

export type ActivityEvent =
  | { type: 'thinking'; content: string; ts: string }
  | { type: 'step_started'; step_number: number; tool_name: string; ts: string }
  | { type: 'step_done'; step_number: number; tool_name: string; ts: string }
  | { type: 'step_failed'; step_number: number; error: string; ts: string }
  | { type: 'response'; content: string; ts: string }
  | { type: 'complete'; finish_reason: string; iterations: number; ts: string }
  | { type: 'failed'; error: string; ts: string }
  | { type: 'approval_required'; action_type: string; description: string; ts: string }
  | { type: 'artifact_created'; title: string; artifact_type: string; ts: string }
  | { type: 'status_update'; status: string; message: string; ts: string }

function EventRow({ event }: { event: ActivityEvent }) {
  const time = new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  if (event.type === 'thinking') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconBrain size={13} className="text-purple-400 shrink-0 mt-0.5" />
        <span className="text-text-secondary italic line-clamp-2">{event.content}</span>
      </div>
    )
  }

  if (event.type === 'step_started') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconTools size={13} className="text-yellow-400 shrink-0 mt-0.5" />
        <span className="text-text-primary">
          <span className="font-mono text-desert-green">{event.tool_name}</span>
          <span className="text-text-secondary"> — calling…</span>
        </span>
      </div>
    )
  }

  if (event.type === 'step_done') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconCheck size={13} className="text-desert-green shrink-0 mt-0.5" />
        <span className="text-text-primary">
          <span className="font-mono text-desert-green">{event.tool_name}</span>
          <span className="text-text-secondary"> — done</span>
        </span>
      </div>
    )
  }

  if (event.type === 'step_failed') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconX size={13} className="text-red-400 shrink-0 mt-0.5" />
        <span className="text-red-400">Step #{event.step_number} failed: {event.error}</span>
      </div>
    )
  }

  if (event.type === 'approval_required') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconAlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5" />
        <span className="text-orange-400 font-medium">Approval required: {event.action_type}</span>
      </div>
    )
  }

  if (event.type === 'artifact_created') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconCheck size={13} className="text-blue-400 shrink-0 mt-0.5" />
        <span className="text-blue-400">Artifact created: <span className="font-medium">{event.title}</span></span>
      </div>
    )
  }

  if (event.type === 'complete') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconCheck size={13} className="text-desert-green shrink-0 mt-0.5" />
        <span className="text-desert-green font-medium">
          Task complete — {event.finish_reason} ({event.iterations} iteration{event.iterations !== 1 ? 's' : ''})
        </span>
      </div>
    )
  }

  if (event.type === 'failed') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconX size={13} className="text-red-400 shrink-0 mt-0.5" />
        <span className="text-red-400 font-medium">Task failed: {event.error}</span>
      </div>
    )
  }

  if (event.type === 'status_update') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-text-secondary font-mono shrink-0 mt-0.5">{time}</span>
        <IconInfoCircle size={13} className="text-text-secondary shrink-0 mt-0.5" />
        <span className="text-text-secondary">{event.message}</span>
      </div>
    )
  }

  return null
}

export default function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1 shrink-0">
        <IconActivity size={13} /> Activity
      </h2>
      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
          <IconActivity size={20} className="text-text-secondary mb-1" />
          <p className="text-xs text-text-secondary">No activity yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1">
          {events.map((e, i) => (
            <EventRow key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  )
}
