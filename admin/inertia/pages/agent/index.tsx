import { Head } from '@inertiajs/react'
import { useQuery } from '@tanstack/react-query'
import AgentLayout from '~/layouts/AgentLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { ServiceSlim } from '../../../types/services'
import {
  IconCheck,
  IconX,
  IconLoader2,
  IconWifi,
  IconWifiOff,
  IconBrain,
  IconCloudComputing,
  IconRefresh,
  IconRobot,
  IconTools,
  IconDownload,
  IconAlertTriangle,
} from '@tabler/icons-react'
import axios from 'axios'

interface AgentStatus {
  status: string
  provider: 'ollama' | 'openrouter'
  internet: boolean
  services: { service_name: string; friendly_name: string | null; installed: boolean; installation_status: string; ui_location: string | null }[]
  models: string[]
  downloads: { active: number; jobs: { id: string; status: string; progress?: number; name?: string }[] }
  disk: { disk: unknown[]; fsSize: unknown[] } | null
}

function ProviderBadge({ provider }: { provider: 'ollama' | 'openrouter' }) {
  return provider === 'ollama' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-desert-green/10 text-desert-green px-3 py-1 text-sm font-medium">
      <IconBrain size={14} /> Ollama (local)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-3 py-1 text-sm font-medium">
      <IconCloudComputing size={14} /> OpenRouter (cloud)
    </span>
  )
}

function ServiceRow({ svc }: { svc: AgentStatus['services'][0] }) {
  const icon = svc.installed
    ? svc.installation_status === 'installing'
      ? <IconLoader2 size={16} className="animate-spin text-yellow-500" />
      : <IconCheck size={16} className="text-desert-green" />
    : <IconX size={16} className="text-text-secondary" />

  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-primary last:border-0">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-text-primary">{svc.friendly_name ?? svc.service_name}</span>
      </div>
      <span className="text-xs text-text-secondary font-mono">{svc.service_name}</span>
    </div>
  )
}

export default function AgentIndexPage(props: {
  agent: {
    provider: 'ollama' | 'openrouter'
    internet: boolean
    services: ServiceSlim[]
  }
}) {
  const { data: status, isLoading, refetch } = useQuery<AgentStatus>({
    queryKey: ['agent-status'],
    queryFn: async () => {
      const res = await axios.get('/api/agent/status')
      return res.data
    },
    initialData: {
      status: 'ok',
      provider: props.agent.provider,
      internet: props.agent.internet,
      services: props.agent.services as AgentStatus['services'],
      models: [],
      downloads: { active: 0, jobs: [] },
      disk: null,
    },
    refetchInterval: 10000,
  })

  const installed = status.services.filter((s) => s.installed)
  const notInstalled = status.services.filter((s) => !s.installed)

  return (
    <AgentLayout>
      <Head title="Agent Console" />
      <main className="xl:pl-72 flex flex-col flex-1 min-h-screen">
        <div className="max-w-5xl w-full mx-auto px-6 py-8 flex flex-col gap-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <StyledSectionHeader
              title="Agent Console"
              description="Monitor and control your NOMAD AI agent infrastructure"
            />
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1 text-sm text-text-secondary hover:text-desert-green transition-colors"
              disabled={isLoading}
            >
              <IconRefresh size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* Status Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-surface-primary p-4 flex flex-col gap-2 shadow-sm">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wide">
                {status.internet ? <IconWifi size={14} /> : <IconWifiOff size={14} />} Network
              </div>
              <p className={`text-lg font-semibold ${status.internet ? 'text-desert-green' : 'text-yellow-500'}`}>
                {status.internet ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="rounded-xl bg-surface-primary p-4 flex flex-col gap-2 shadow-sm">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wide">
                <IconBrain size={14} /> Provider
              </div>
              <ProviderBadge provider={status.provider} />
            </div>
            <div className="rounded-xl bg-surface-primary p-4 flex flex-col gap-2 shadow-sm">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wide">
                <IconRobot size={14} /> Services
              </div>
              <p className="text-lg font-semibold text-text-primary">
                {installed.length} <span className="text-sm text-text-secondary font-normal">/ {status.services.length} installed</span>
              </p>
            </div>
            <div className="rounded-xl bg-surface-primary p-4 flex flex-col gap-2 shadow-sm">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wide">
                <IconDownload size={14} /> Downloads
              </div>
              <p className={`text-lg font-semibold ${status.downloads.active > 0 ? 'text-yellow-500' : 'text-text-primary'}`}>
                {status.downloads.active} active
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <a href="/agent/run" className="inline-flex items-center gap-2 rounded-lg bg-desert-green text-white px-4 py-2 text-sm font-medium hover:bg-desert-green/90 transition-colors">
                <IconRobot size={16} /> Run Agent Task
              </a>
              <a href="/agent/tools" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary text-text-primary px-4 py-2 text-sm font-medium hover:bg-desert-green-light hover:text-white transition-colors">
                <IconTools size={16} /> Explore Tools
              </a>
              <a href="/api/agent/tools" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary text-text-primary px-4 py-2 text-sm font-medium hover:bg-desert-green-light hover:text-white transition-colors">
                OpenAI Tools JSON
              </a>
              <a href="/.well-known/agents.json" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary text-text-primary px-4 py-2 text-sm font-medium hover:bg-desert-green-light hover:text-white transition-colors">
                Agent Card
              </a>
              <a href="/openapi.json" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary text-text-primary px-4 py-2 text-sm font-medium hover:bg-desert-green-light hover:text-white transition-colors">
                OpenAPI Spec
              </a>
            </div>
          </div>

          {/* Models */}
          {status.models.length > 0 && (
            <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Available Models</h2>
              <div className="flex flex-wrap gap-2">
                {status.models.map((m) => (
                  <span key={m} className="rounded-full bg-desert-green/10 text-desert-green px-3 py-1 text-sm font-mono">{m}</span>
                ))}
              </div>
            </div>
          )}

          {/* Services Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4 flex items-center gap-2">
                <IconCheck size={14} className="text-desert-green" /> Installed Services
              </h2>
              {installed.length === 0
                ? <p className="text-sm text-text-secondary">No services installed yet.</p>
                : installed.map((s) => <ServiceRow key={s.service_name} svc={s} />)}
            </div>
            <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4 flex items-center gap-2">
                <IconAlertTriangle size={14} className="text-yellow-500" /> Available to Install
              </h2>
              {notInstalled.length === 0
                ? <p className="text-sm text-text-secondary">All services are installed.</p>
                : notInstalled.map((s) => <ServiceRow key={s.service_name} svc={s} />)}
            </div>
          </div>

          {/* Active Downloads */}
          {status.downloads.jobs.length > 0 && (
            <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Active Downloads</h2>
              {status.downloads.jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b border-surface-secondary last:border-0">
                  <span className="text-sm text-text-primary font-mono truncate max-w-xs">{job.name ?? job.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${job.status === 'active' ? 'bg-yellow-100 text-yellow-700' : 'bg-surface-secondary text-text-secondary'}`}>
                    {job.status}{job.progress !== undefined ? ` ${job.progress}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* API Reference */}
          <div className="rounded-xl bg-surface-primary p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Agent API Endpoints</h2>
            <div className="space-y-2 font-mono text-xs">
              {([
                ['POST', '/mcp', 'MCP JSON-RPC 2.0 (initialize / tools/list / tools/call)'],
                ['GET', '/mcp/tools', 'List MCP tools (REST)'],
                ['POST', '/mcp/call', 'Call MCP tool (REST)'],
                ['POST', '/api/agent/run', 'Run autonomous agentic task'],
                ['GET', '/api/agent/status', 'System status snapshot'],
                ['POST', '/api/agent/setup', 'Headless system setup'],
                ['GET', '/api/agent/tools', 'OpenAI-format tool list'],
                ['POST', '/v1/chat/completions', 'OpenAI-compat chat (streaming + tools)'],
                ['GET', '/v1/models', 'OpenAI-compat model list'],
              ] as const).map(([method, path, desc]) => (
                <div key={path} className="flex items-start gap-3">
                  <span className={`shrink-0 w-12 text-center rounded px-1 py-0.5 text-[10px] font-bold ${method === 'GET' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-desert-green/10 text-desert-green'}`}>
                    {method}
                  </span>
                  <a href={path} target="_blank" rel="noopener noreferrer" className="text-desert-green hover:underline shrink-0">{path}</a>
                  <span className="text-text-secondary hidden sm:block">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </AgentLayout>
  )
}
