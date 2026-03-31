/**
 * NOMAD agent skills manifest.
 *
 * Follows the agentskills.io / skills.md convention:
 *   YAML-style metadata + structured skill definitions.
 *
 * Served as:
 *   - GET /skills.md   → Markdown (human + machine readable)
 *   - /.well-known/agents.json  → JSON (part of agent card)
 */

export interface NomadSkill {
  id: string
  name: string
  description: string
  category: string
  mcpTool?: string
  inputs: { name: string; type: string; required: boolean; description: string }[]
  outputs: { name: string; type: string; description: string }[]
  examples: { description: string; input: Record<string, unknown> }[]
}

export const NOMAD_SKILLS: NomadSkill[] = [
  // ─── Knowledge ─────────────────────────────────────────────────────────────
  {
    id: 'knowledge-search',
    name: 'Semantic Knowledge Search',
    description:
      'Search across all locally indexed documents, notes, and uploaded files using vector similarity (RAG via Qdrant). Returns the most relevant text chunks with confidence scores.',
    category: 'knowledge',
    mcpTool: 'nomad_search_knowledge',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'Natural-language query' },
      { name: 'limit', type: 'integer', required: false, description: 'Max results (default 5)' },
      { name: 'min_score', type: 'number', required: false, description: 'Min similarity 0-1 (default 0.3)' },
    ],
    outputs: [{ name: 'results', type: 'array', description: 'Array of {text, source, score}' }],
    examples: [
      { description: 'Find water purification information', input: { query: 'field water purification methods', limit: 5 } },
    ],
  },
  {
    id: 'wikipedia-search',
    name: 'Offline Wikipedia Search',
    description:
      'Search article titles and content snippets from the locally installed Wikipedia ZIM file (via Kiwix). Fully offline after initial download.',
    category: 'knowledge',
    mcpTool: 'nomad_search_wikipedia',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'Search query' },
      { name: 'limit', type: 'integer', required: false, description: 'Max results (default 5)' },
    ],
    outputs: [{ name: 'results', type: 'array', description: 'Array of {title, snippet, path}' }],
    examples: [
      { description: 'Look up water filtration', input: { query: 'water filtration', limit: 3 } },
    ],
  },
  {
    id: 'internet-archive-search',
    name: 'Internet Archive Search',
    description:
      'Search the locally cached Internet Archive mirror (dweb-mirror). Access 38M+ books, historical documents, audio, video, and software — offline after caching.',
    category: 'knowledge',
    mcpTool: 'nomad_search_internet_archive',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'Search query' },
      { name: 'rows', type: 'integer', required: false, description: 'Result count (default 10)' },
      { name: 'media_type', type: 'string', required: false, description: 'texts | audio | video | software | image' },
    ],
    outputs: [{ name: 'items', type: 'array', description: 'Array of Archive items with identifier, title, description' }],
    examples: [
      { description: 'Find books about emergency medicine', input: { query: 'emergency medicine field guide', media_type: 'texts', rows: 5 } },
    ],
  },

  // ─── AI Inference ───────────────────────────────────────────────────────────
  {
    id: 'local-chat',
    name: 'RAG-Augmented Local Chat',
    description:
      'Chat with the local LLM (Ollama or OpenRouter depending on configuration). Automatically retrieves relevant context from the knowledge base before responding.',
    category: 'ai',
    mcpTool: 'nomad_chat',
    inputs: [
      { name: 'message', type: 'string', required: true, description: 'User message' },
      { name: 'model', type: 'string', required: false, description: 'Model name override' },
      { name: 'use_rag', type: 'boolean', required: false, description: 'Inject RAG context (default true)' },
      { name: 'system_prompt', type: 'string', required: false, description: 'System instruction override' },
    ],
    outputs: [{ name: 'response', type: 'string', description: 'LLM-generated response' }],
    examples: [
      { description: 'Ask a question with local context', input: { message: 'What are the best foods for long-term storage?' } },
    ],
  },
  {
    id: 'model-management',
    name: 'AI Model Management',
    description: 'List installed AI models and queue Ollama model downloads.',
    category: 'ai',
    mcpTool: 'nomad_list_models',
    inputs: [],
    outputs: [{ name: 'models', type: 'array', description: 'Installed model names' }],
    examples: [{ description: 'List available models', input: {} }],
  },

  // ─── System ─────────────────────────────────────────────────────────────────
  {
    id: 'system-health',
    name: 'System Health Check',
    description:
      'Get a full snapshot of the NOMAD system: service states, internet connectivity, AI provider, and readiness.',
    category: 'system',
    mcpTool: 'nomad_health',
    inputs: [],
    outputs: [
      { name: 'status', type: 'string', description: '"ok"' },
      { name: 'services', type: 'array', description: 'Service states' },
      { name: 'internet', type: 'boolean', description: 'Internet connectivity' },
    ],
    examples: [{ description: 'Check system health before task execution', input: {} }],
  },
  {
    id: 'service-control',
    name: 'Service Lifecycle Control',
    description:
      'Install, start, stop, or restart any NOMAD service (Kiwix, Ollama, Qdrant, FlatNotes, CyberChef, Kolibri, IA Mirror).',
    category: 'system',
    mcpTool: 'nomad_control_service',
    inputs: [
      { name: 'service_name', type: 'string', required: true, description: 'Internal service identifier' },
      { name: 'action', type: 'string', required: true, description: 'start | stop | restart' },
    ],
    outputs: [{ name: 'success', type: 'boolean', description: 'Whether the action succeeded' }],
    examples: [
      { description: 'Restart the AI assistant', input: { service_name: 'nomad_ollama', action: 'restart' } },
    ],
  },
  {
    id: 'headless-setup',
    name: 'Headless System Setup',
    description:
      'Configure and install the entire NOMAD system without human interaction. Select services, Wikipedia tier, and AI models in one API call.',
    category: 'system',
    inputs: [
      { name: 'services', type: 'string[]', required: false, description: 'Service names to install' },
      { name: 'wikipedia_tier_id', type: 'string', required: false, description: 'Wikipedia content tier' },
      { name: 'ollama_models', type: 'string[]', required: false, description: 'Ollama model names to download' },
    ],
    outputs: [{ name: 'results', type: 'object', description: 'Per-action success/failure summary' }],
    examples: [
      {
        description: 'Full minimal setup',
        input: {
          services: ['nomad_kiwix_server', 'nomad_ollama', 'nomad_qdrant'],
          wikipedia_tier_id: 'openzim_en-mini',
          ollama_models: ['llama3.2:3b'],
        },
      },
    ],
  },

  // ─── Observability ──────────────────────────────────────────────────────────
  {
    id: 'storage-status',
    name: 'Storage Status',
    description: 'Get disk usage and filesystem sizes across all NOMAD storage locations.',
    category: 'observability',
    mcpTool: 'nomad_storage_status',
    inputs: [],
    outputs: [{ name: 'disk', type: 'array', description: 'Disk layout and usage' }],
    examples: [{ description: 'Check available storage before downloading content', input: {} }],
  },
  {
    id: 'download-status',
    name: 'Download Job Status',
    description: 'List active and failed download jobs (ZIM files, maps, AI models) with progress.',
    category: 'observability',
    mcpTool: 'nomad_download_status',
    inputs: [],
    outputs: [{ name: 'jobs', type: 'array', description: 'Active download jobs with progress %' }],
    examples: [{ description: 'Poll download progress', input: {} }],
  },

  // ─── Maps ───────────────────────────────────────────────────────────────────
  {
    id: 'offline-maps',
    name: 'Offline Map Regions',
    description: 'List downloaded offline map regions (PMTiles format, OpenStreetMap-compatible).',
    category: 'maps',
    mcpTool: 'nomad_list_map_regions',
    inputs: [],
    outputs: [{ name: 'files', type: 'array', description: 'Downloaded map region files' }],
    examples: [{ description: 'List available offline maps', input: {} }],
  },
]

/**
 * Generate the /skills.md content — YAML frontmatter + Markdown body.
 */
export function generateSkillsMd(baseUrl: string): string {
  const frontmatter = {
    name: 'project-nomad',
    version: '1.0.0',
    description: 'Offline AI-agent-first knowledge infrastructure',
    base_url: baseUrl,
    mcp_endpoint: `${baseUrl}/mcp`,
    openai_endpoint: `${baseUrl}/v1`,
    skills: NOMAD_SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      mcp_tool: s.mcpTool ?? null,
    })),
  }

  const yamlLines = (obj: unknown, indent = 0): string => {
    if (typeof obj === 'string') return JSON.stringify(obj)
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj)
    if (obj === null) return 'null'
    if (Array.isArray(obj)) {
      return '\n' + obj.map((item) => ' '.repeat(indent) + '  - ' + yamlLines(item, indent + 4)).join('\n')
    }
    return '\n' + Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => ' '.repeat(indent) + '  ' + k + ': ' + yamlLines(v, indent + 2))
      .join('\n')
  }

  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${yamlLines(v)}`)
    .join('\n')

  const skillsSections = NOMAD_SKILLS.map((s) => {
    const inputTable = s.inputs.length
      ? '\n| Name | Type | Required | Description |\n|---|---|---|---|\n' +
        s.inputs.map((i) => `| \`${i.name}\` | ${i.type} | ${i.required ? '✓' : '—'} | ${i.description} |`).join('\n')
      : '\n_No inputs required._'

    const example =
      s.examples.length
        ? '\n```json\n' + JSON.stringify(s.examples[0].input, null, 2) + '\n```'
        : ''

    return `### ${s.name}

**Category:** \`${s.category}\`${s.mcpTool ? `  |  **MCP Tool:** \`${s.mcpTool}\`` : ''}

${s.description}

**Inputs:**${inputTable}

**Example input:**${example || '\n_None_'}
`
  }).join('\n---\n\n')

  return `---
${fm}
---

# Project N.O.M.A.D. — Skills Manifest

This file describes the skills (callable capabilities) exposed by this NOMAD instance.
It is machine-readable via the YAML frontmatter and human-readable via the Markdown body.

Consume tools at:
- **MCP JSON-RPC:** \`POST ${baseUrl}/mcp\`
- **MCP REST:** \`POST ${baseUrl}/mcp/call\`
- **OpenAI-compat:** \`POST ${baseUrl}/v1/chat/completions\`
- **Tool list:** \`GET ${baseUrl}/api/agent/tools\`

---

## Skills

${skillsSections}`
}
