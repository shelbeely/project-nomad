import {
  IconServer,
  IconCheck,
  IconX,
  IconLoader2,
  IconAlertTriangle,
  IconBrain,
  IconCloudComputing,
  IconRobot,
} from '@tabler/icons-react'

export type ServiceInfo = {
  service_name: string
  friendly_name: string | null
  installed: boolean
  installation_status: string
}

export type OperatorStatus = {
  provider: string
  models: string[]
  services: ServiceInfo[]
  pendingApprovals: number
  activeTasks: number
}

function ServiceDot({ service }: { service: ServiceInfo }) {
  if (!service.installed) {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-surface-primary border border-text-secondary/30" title="Not installed" />
  }
  if (service.installation_status === 'installing') {
    return <IconLoader2 size={10} className="animate-spin text-yellow-500" title="Installing" />
  }
  if (service.installation_status === 'running') {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-desert-green" title="Running" />
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-secondary/40" title={service.installation_status} />
}

export default function SystemStatusPanel({ status }: { status: OperatorStatus }) {
  const runningServices = status.services.filter(
    (s) => s.installed && s.installation_status === 'running'
  )
  const installedServices = status.services.filter((s) => s.installed)
  const agentReady = status.models.length > 0

  return (
    <div className="flex flex-col gap-3 h-full">
      <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1 shrink-0">
        <IconServer size={13} /> System Status
      </h2>

      {/* Summary badges */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-secondary/30 p-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wide">Provider</span>
          {status.provider === 'ollama' ? (
            <span className="flex items-center gap-1 text-xs text-desert-green">
              <IconBrain size={11} /> Ollama
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <IconCloudComputing size={11} /> OpenRouter
            </span>
          )}
        </div>
        <div className="rounded-lg bg-surface-secondary/30 p-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wide">Agent</span>
          {agentReady ? (
            <span className="flex items-center gap-1 text-xs text-desert-green">
              <IconRobot size={11} /> Ready
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <IconX size={11} /> No model
            </span>
          )}
        </div>
        <div className="rounded-lg bg-surface-secondary/30 p-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wide">Services</span>
          <span className="text-xs text-text-primary">
            <span className={runningServices.length > 0 ? 'text-desert-green' : 'text-text-secondary'}>
              {runningServices.length}
            </span>
            <span className="text-text-secondary">/{installedServices.length} running</span>
          </span>
        </div>
        <div className="rounded-lg bg-surface-secondary/30 p-2 flex flex-col gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wide">Approvals</span>
          <span className={`text-xs font-medium ${status.pendingApprovals > 0 ? 'text-orange-400' : 'text-text-secondary'}`}>
            {status.pendingApprovals > 0 ? (
              <span className="flex items-center gap-1">
                <IconAlertTriangle size={11} /> {status.pendingApprovals} pending
              </span>
            ) : (
              'None'
            )}
          </span>
        </div>
      </div>

      {/* Models */}
      {status.models.length > 0 && (
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wide mb-1">Models</p>
          <div className="flex flex-wrap gap-1">
            {status.models.slice(0, 4).map((m) => (
              <span key={m} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-desert-green/10 text-desert-green">
                {m}
              </span>
            ))}
            {status.models.length > 4 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-secondary text-text-secondary">
                +{status.models.length - 4}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Service list */}
      <div className="flex-1 overflow-y-auto">
        <p className="text-[10px] text-text-secondary uppercase tracking-wide mb-1">Services</p>
        <div className="flex flex-col gap-0.5">
          {status.services.map((s) => (
            <div key={s.service_name} className="flex items-center gap-1.5 text-xs py-0.5">
              <ServiceDot service={s} />
              <span className="text-text-primary truncate flex-1">
                {s.friendly_name ?? s.service_name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
