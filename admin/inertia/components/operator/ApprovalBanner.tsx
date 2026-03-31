import {
  IconAlertTriangle,
  IconCheck,
  IconX,
} from '@tabler/icons-react'

export type PendingApproval = {
  id: number
  task_id: number
  task_title: string
  action_type: string
  action_description: string
  created_at: string
}

interface ApprovalBannerProps {
  approvals: PendingApproval[]
  onApprove: (id: number) => Promise<void>
  onDeny: (id: number) => Promise<void>
}

export default function ApprovalBanner({ approvals, onApprove, onDeny }: ApprovalBannerProps) {
  if (approvals.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {approvals.map((ap) => (
        <div
          key={ap.id}
          className="rounded-xl border border-orange-400/40 bg-orange-500/5 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
        >
          <IconAlertTriangle size={20} className="text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-400">Approval Required</p>
            <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
              <span className="font-medium text-text-primary">{ap.task_title}</span>
              {' — '}{ap.action_description}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => onApprove(ap.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-desert-green text-white px-3 py-1.5 text-xs font-medium hover:bg-desert-green/90 transition-colors"
            >
              <IconCheck size={13} /> Approve
            </button>
            <button
              onClick={() => onDeny(ap.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-red-500/10 text-red-400 border border-red-400/30 px-3 py-1.5 text-xs font-medium hover:bg-red-500/20 transition-colors"
            >
              <IconX size={13} /> Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
