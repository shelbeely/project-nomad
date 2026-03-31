import { Head } from '@inertiajs/react'
import { useState } from 'react'
import AgentLayout from '~/layouts/AgentLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import {
  IconTools,
  IconSearch,
  IconPlay,
  IconLoader2,
  IconChevronRight,
  IconAlertCircle,
  IconCheck,
} from '@tabler/icons-react'
import axios from 'axios'

interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>
    required?: string[]
  }
}

type McpResult = {
  content: { type: string; text: string }[]
  isError?: boolean
}

function SchemaForm({
  schema,
  values,
  onChange,
}: {
  schema: McpTool['inputSchema']
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const entries = Object.entries(properties)

  if (entries.length === 0) {
    return <p className="text-xs text-text-secondary italic">This tool requires no arguments.</p>
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, prop]) => (
        <div key={key}>
          <label className="block text-xs font-medium text-text-primary mb-1">
            <span className="font-mono">{key}</span>
            {required.has(key) && <span className="text-red-500 ml-1">*</span>}
            {prop.type && <span className="text-text-secondary font-normal ml-1">({prop.type})</span>}
          </label>
          {prop.description && (
            <p className="text-[11px] text-text-secondary mb-1">{prop.description}</p>
          )}
          {prop.enum ? (
            <select
              value={values[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-desert-green"
            >
              <option value="">— select —</option>
              {prop.enum.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : prop.type === 'boolean' ? (
            <select
              value={values[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-desert-green"
            >
              <option value="">— select —</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              type={prop.type === 'integer' || prop.type === 'number' ? 'number' : 'text'}
              value={values[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              className="w-full rounded-lg border border-surface-secondary bg-surface-secondary text-text-primary text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-desert-green"
              placeholder={prop.description ?? key}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function AgentToolsPage(props: {
  agent: {
    provider: 'ollama' | 'openrouter'
    tools: McpTool[]
  }
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<McpTool | null>(props.agent.tools[0] ?? null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<McpResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = props.agent.tools.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelect = (tool: McpTool) => {
    setSelected(tool)
    setFormValues({})
    setResult(null)
    setError(null)
  }

  const handleFormChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }

  const buildArgs = (): Record<string, unknown> => {
    if (!selected) return {}
    const properties = selected.inputSchema.properties ?? {}
    const args: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      const raw = formValues[key]
      if (raw === undefined || raw === '') continue
      if (prop.type === 'integer' || prop.type === 'number') {
        const n = Number(raw)
        if (!Number.isNaN(n)) args[key] = n
      } else if (prop.type === 'boolean') {
        args[key] = raw === 'true'
      } else {
        args[key] = raw
      }
    }
    return args
  }

  const handleCall = async () => {
    if (!selected || running) return
    setRunning(true)
    setResult(null)
    setError(null)

    try {
      const res = await axios.post<McpResult>('/mcp/call', {
        name: selected.name,
        arguments: buildArgs(),
      })
      setResult(res.data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
    } finally {
      setRunning(false)
    }
  }

  const resultText = result?.content?.[0]?.text ?? ''
  let resultFormatted: string
  try {
    resultFormatted = JSON.stringify(JSON.parse(resultText), null, 2)
  } catch {
    resultFormatted = resultText
  }

  return (
    <AgentLayout>
      <Head title="Tool Explorer" />
      <main className="xl:pl-72 flex flex-col flex-1 min-h-screen">
        <div className="max-w-6xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
          <StyledSectionHeader
            title="Tool Explorer"
            description={`${props.agent.tools.length} MCP tools available — browse, inspect schemas, and call tools manually`}
          />

          <div className="flex flex-col lg:flex-row gap-6 min-h-[600px]">
            {/* Tool List */}
            <div className="lg:w-72 shrink-0 flex flex-col gap-3">
              <div className="relative">
                <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter tools…"
                  className="w-full rounded-lg border border-surface-secondary bg-surface-primary text-text-primary text-sm pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-desert-green"
                />
              </div>
              <div className="flex flex-col gap-1 overflow-y-auto max-h-[560px] pr-1">
                {filtered.map((tool) => (
                  <button
                    key={tool.name}
                    onClick={() => handleSelect(tool)}
                    className={`text-left px-3 py-2.5 rounded-lg transition-colors group ${selected?.name === tool.name ? 'bg-desert-green text-white' : 'hover:bg-surface-primary text-text-primary'}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-mono font-medium truncate">{tool.name}</p>
                      <IconChevronRight size={12} className={`shrink-0 ${selected?.name === tool.name ? 'text-white/70' : 'text-text-secondary group-hover:text-text-primary'}`} />
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-xs text-text-secondary px-3 py-2">No tools match your search.</p>
                )}
              </div>
            </div>

            {/* Tool Detail + Executor */}
            <div className="flex-1 rounded-xl bg-surface-primary p-6 shadow-sm flex flex-col gap-5">
              {selected ? (
                <>
                  {/* Tool Header */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <IconTools size={18} className="text-desert-green" />
                      <h2 className="text-base font-semibold text-text-primary font-mono">{selected.name}</h2>
                    </div>
                    <p className="text-sm text-text-secondary">{selected.description}</p>
                  </div>

                  {/* Arguments Form */}
                  <div>
                    <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">Arguments</h3>
                    <SchemaForm
                      schema={selected.inputSchema}
                      values={formValues}
                      onChange={handleFormChange}
                    />
                  </div>

                  {/* Call Button */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleCall}
                      disabled={running}
                      className="inline-flex items-center gap-2 rounded-lg bg-desert-green text-white px-4 py-2 text-sm font-medium hover:bg-desert-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {running ? <IconLoader2 size={15} className="animate-spin" /> : <IconPlay size={15} />}
                      {running ? 'Calling…' : 'Call Tool'}
                    </button>
                    <a
                      href={`/mcp/tools`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-text-secondary hover:text-desert-green transition-colors"
                    >
                      View full schema JSON ↗
                    </a>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-4 flex items-start gap-2">
                      <IconAlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-600 dark:text-red-300 font-mono">{error}</p>
                    </div>
                  )}

                  {/* Result */}
                  {result && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {result.isError
                          ? <IconAlertCircle size={15} className="text-red-500" />
                          : <IconCheck size={15} className="text-desert-green" />}
                        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                          {result.isError ? 'Error' : 'Result'}
                        </h3>
                      </div>
                      <pre className="text-xs bg-surface-secondary rounded-lg p-4 overflow-auto max-h-72 text-text-primary leading-relaxed">
                        {resultFormatted || '(empty result)'}
                      </pre>
                    </div>
                  )}

                  {/* Raw Schema */}
                  <details className="mt-auto">
                    <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary select-none">
                      View raw JSON schema
                    </summary>
                    <pre className="text-xs bg-surface-secondary rounded-lg p-3 mt-2 overflow-auto max-h-40 text-text-primary">
                      {JSON.stringify(selected.inputSchema, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-text-secondary text-sm">
                  Select a tool from the list to inspect and call it.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </AgentLayout>
  )
}
