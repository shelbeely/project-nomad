/**
 * MCP (Model Context Protocol) tool definitions for Project N.O.M.A.D.
 *
 * Each entry follows the MCP tool schema:
 *   { name, description, inputSchema }
 *
 * These definitions are served at GET /mcp/tools and used by the McpController
 * dispatcher to validate and route tool calls from POST /mcp/call.
 */
export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const NOMAD_MCP_TOOLS: McpTool[] = [
  // ─── System & Lifecycle ───────────────────────────────────────────────────
  {
    name: 'nomad_health',
    description:
      'Get a full system health snapshot: service states, internet connectivity, and AI/vector-DB readiness.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nomad_list_services',
    description:
      'List all NOMAD services (installed and available) with their running status, image, and UI location.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nomad_install_service',
    description:
      'Install a NOMAD service by its service_name. Call nomad_list_services first to get the current list of installable service names.',
    inputSchema: {
      type: 'object',
      required: ['service_name'],
      properties: {
        service_name: { type: 'string', description: 'Internal service identifier (e.g. nomad_ollama). Call nomad_list_services to enumerate available names.' },
      },
    },
  },
  {
    name: 'nomad_control_service',
    description: 'Start, stop, or restart an installed NOMAD service.',
    inputSchema: {
      type: 'object',
      required: ['service_name', 'action'],
      properties: {
        service_name: { type: 'string' },
        action: { type: 'string', enum: ['start', 'stop', 'restart'] },
      },
    },
  },

  // ─── Knowledge / RAG ─────────────────────────────────────────────────────
  {
    name: 'nomad_search_knowledge',
    description:
      'Semantic search across all indexed local knowledge (uploaded documents, notes, indexed files). Returns the most relevant text chunks with similarity scores.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 5)',
        },
        min_score: {
          type: 'number',
          description: 'Minimum similarity score 0-1 (default: 0.3)',
        },
      },
    },
  },
  {
    name: 'nomad_search_wikipedia',
    description:
      'Search article titles and snippets from the offline Wikipedia/Kiwix library installed on this device.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', description: 'Max results (default: 5)' },
      },
    },
  },
  {
    name: 'wiki_open_article',
    description:
      'Fetch the full plain-text content of a single article from the locally installed Kiwix wiki. Use search_wiki first to find the exact title.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Article title (e.g. "Water purification")' },
      },
    },
  },
  {
    name: 'wiki_open_section',
    description:
      'Extract a specific named section from a locally installed Kiwix wiki article (e.g. "History", "Symptoms", "Treatment"). Returns only the text of that section.',
    inputSchema: {
      type: 'object',
      required: ['title', 'section'],
      properties: {
        title: { type: 'string', description: 'Article title' },
        section: { type: 'string', description: 'Section heading name (case-insensitive, partial match allowed)' },
      },
    },
  },
  {
    name: 'wiki_quote_passages',
    description:
      'Find and return short relevant passages from the local Kiwix wiki that contain keywords from the query. Useful for grounding answers in cited text.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Topic or question to find passages for' },
        limit: { type: 'integer', description: 'Max passages to return (default: 5, max: 10)' },
      },
    },
  },
  {
    name: 'wiki_verify_claim',
    description:
      'Verify a factual claim against the locally installed Kiwix wiki. Returns a verdict (supported / contradicted / not_found) and the evidence passages found.',
    inputSchema: {
      type: 'object',
      required: ['claim'],
      properties: {
        claim: { type: 'string', description: 'The factual claim to verify (e.g. "Boiling water for 1 minute kills all pathogens")' },
      },
    },
  },

  // ─── AI Inference ─────────────────────────────────────────────────────────
  {
    name: 'nomad_chat',
    description:
      'Send a message to the local LLM (Ollama or OpenRouter depending on configuration). RAG context from the local knowledge base is automatically injected when relevant.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string' },
        model: {
          type: 'string',
          description: 'Model name. Defaults to the last-used or configured model.',
        },
        system_prompt: { type: 'string', description: 'Optional system-level instruction' },
        use_rag: {
          type: 'boolean',
          description: 'Whether to inject RAG context (default: true)',
        },
      },
    },
  },
  {
    name: 'nomad_list_models',
    description:
      'List the AI models currently available on this NOMAD instance (installed Ollama models, or the configured OpenRouter model).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nomad_download_model',
    description:
      'Download an Ollama model by name (e.g. "llama3.2:3b"). Dispatches an async background job. Poll nomad_download_status for progress.',
    inputSchema: {
      type: 'object',
      required: ['model_name'],
      properties: {
        model_name: { type: 'string' },
      },
    },
  },

  // ─── Maps ─────────────────────────────────────────────────────────────────
  {
    name: 'nomad_list_map_regions',
    description: 'List downloaded offline map regions (PMTiles files) and their file sizes.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ─── Internet Archive ─────────────────────────────────────────────────────
  {
    name: 'nomad_search_internet_archive',
    description:
      'Search the locally cached Internet Archive mirror (dweb-mirror) for books, historical documents, audio, video, and software. Returns items with identifiers, titles, and descriptions.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        rows: { type: 'integer', description: 'Number of results (default: 10, max: 50)' },
        media_type: {
          type: 'string',
          description: 'Filter by media type: texts, audio, video, software, image, collection',
        },
      },
    },
  },
  {
    name: 'nomad_get_ia_item',
    description:
      'Get metadata and file list for a specific Internet Archive item by its identifier (e.g. "gutenberg-fiction").',
    inputSchema: {
      type: 'object',
      required: ['identifier'],
      properties: {
        identifier: { type: 'string' },
      },
    },
  },

  // ─── Observability ────────────────────────────────────────────────────────
  {
    name: 'nomad_storage_status',
    description:
      'Get disk usage broken down by category: ZIM files, maps, Ollama models, vector-DB, and uploaded knowledge files.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nomad_download_status',
    description:
      'List active and recently failed download jobs (ZIM files, map tiles, Ollama models) with progress percentages.',
    inputSchema: { type: 'object', properties: {} },
  },
]
