import { inject } from '@adonisjs/core'
import { OllamaService } from './ollama_service.js'
import env from '#start/env'
import axios from 'axios'
import logger from '@adonisjs/core/services/logger'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../constants/ollama.js'
import { randomUUID } from 'node:crypto'
import type { Message as OllamaMessage, Tool as OllamaTool, ToolCall as OllamaToolCall } from 'ollama'

// ---------------------------------------------------------------------------
// Shared type definitions
// ---------------------------------------------------------------------------

/** A single part within a multimodal message content array. */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'video_url'; video_url: { url: string } }

/** Normalised tool-call entry returned by the LLM. */
export type LlmToolCall = {
  /** Unique ID (generated for Ollama which doesn't produce one). */
  id: string
  type: 'function'
  function: {
    name: string
    /** Already-parsed arguments object — never a raw JSON string. */
    arguments: Record<string, unknown>
  }
}

/** Tool definition passed to the LLM. */
export type LlmTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * A chat message. Content may be a plain string or a multimodal content array.
 * The `tool` role is used to return tool execution results back to the LLM.
 */
export type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | LlmContentPart[]
  /** Required when role === 'tool'; links the result to a specific tool call. */
  tool_call_id?: string
  /** Populated by the assistant when it wants to call tools. */
  tool_calls?: LlmToolCall[]
}

export type LlmChatRequest = {
  model: string
  messages: LlmMessage[]
  stream?: boolean
  think?: boolean | string
  tools?: LlmTool[]
  tool_choice?: 'none' | 'auto' | 'required'
}

export type LlmChatChunk = {
  message: {
    role: string
    content: string
    tool_calls?: LlmToolCall[]
  }
  done: boolean
}

/** Single step in an agentic execution trace. */
export type AgenticStep = {
  iteration: number
  tool_calls: LlmToolCall[]
  tool_results: { tool_call_id: string; name: string; result: unknown }[]
}

export type AgenticRunResult = {
  response: string
  model: string
  iterations: number
  trace: AgenticStep[]
  finish_reason: 'stop' | 'max_iterations'
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic LLM service.
 *
 * Reads AI_PROVIDER from the environment:
 *  - 'ollama'      → delegates to local OllamaService (default, fully offline)
 *  - 'openrouter'  → calls OpenRouter's OpenAI-compatible API
 *
 * Supports:
 *  - Text-only and multimodal (image + video) messages
 *  - Tool / function calling (Ollama native + OpenRouter OpenAI-compat)
 *  - Agentic execution loop (auto-executes tool calls until the model stops)
 *
 * Embeddings (RagService) always use local Ollama regardless of AI_PROVIDER.
 */
@inject()
export class LlmService {
  constructor(private ollamaService: OllamaService) {}

  get provider(): 'ollama' | 'openrouter' {
    return (env.get('AI_PROVIDER') ?? 'ollama') as 'ollama' | 'openrouter'
  }

  isOllamaProvider(): boolean {
    return this.provider === 'ollama'
  }

  /**
   * Model name used for query rewriting in the RAG pipeline.
   * Ollama uses a small dedicated local model; OpenRouter falls back to the
   * configured default model.
   */
  getRewriteModel(): string {
    if (this.isOllamaProvider()) return DEFAULT_QUERY_REWRITE_MODEL
    return env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini'
  }

  async isRewriteModelAvailable(): Promise<boolean> {
    if (!this.isOllamaProvider()) return true
    const installed = await this.ollamaService.getModels(true)
    return installed?.some((m) => m.name === DEFAULT_QUERY_REWRITE_MODEL) ?? false
  }

  /** OpenRouter doesn't expose per-model "thinking" capability — always false. */
  async checkModelHasThinking(model: string): Promise<boolean> {
    if (!this.isOllamaProvider()) return false
    return this.ollamaService.checkModelHasThinking(model)
  }

  // ── Model listing ──────────────────────────────────────────────────────────

  async getInstalledModels(includeEmbeddings = false) {
    if (this.isOllamaProvider()) {
      return this.ollamaService.getModels(includeEmbeddings)
    }
    // Return synthetic entries for all configured OpenRouter models
    const models = [
      env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini',
    ]
    const visionModel = env.get('OPENROUTER_VISION_MODEL')
    if (visionModel && !models.includes(visionModel)) models.push(visionModel)

    return models.map((name) => ({
      name,
      model: name,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: '',
      details: { family: 'openrouter', parameter_size: 'unknown', quantization_level: 'none' },
    }))
  }

  // ── Non-streaming chat ─────────────────────────────────────────────────────

  async chat(request: LlmChatRequest): Promise<LlmChatChunk> {
    if (this.isOllamaProvider()) return this._ollamaChat(request)
    return this._openRouterChat(request)
  }

  // ── Streaming chat ─────────────────────────────────────────────────────────

  async *chatStream(request: LlmChatRequest): AsyncGenerator<LlmChatChunk> {
    if (this.isOllamaProvider()) {
      yield* this._ollamaChatStream(request)
      return
    }
    yield* this._openRouterChatStream(request)
  }

  // ── Agentic execution loop ─────────────────────────────────────────────────

  /**
   * Run an agentic loop: call the LLM, execute any tool calls it requests,
   * feed results back, and repeat until the model produces a final response
   * or `maxIterations` is reached.
   *
   * @param request       Initial chat request (should include `tools`).
   * @param toolExecutor  Callback that executes a named tool and returns its result.
   * @param maxIterations Safety ceiling (default 10).
   */
  async runAgenticLoop(
    request: LlmChatRequest,
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    maxIterations = 10
  ): Promise<AgenticRunResult> {
    const messages: LlmMessage[] = [...request.messages]
    const trace: AgenticStep[] = []
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      logger.info(`[LlmService] Agentic loop iteration ${iteration}/${maxIterations}`)

      const result = await this.chat({ ...request, messages, stream: false })

      // If no tool calls — model gave a final answer
      const toolCalls = result.message.tool_calls ?? []
      if (toolCalls.length === 0 || result.done) {
        return {
          response: result.message.content,
          model: request.model,
          iterations: iteration,
          trace,
          finish_reason: 'stop',
        }
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: result.message.content ?? '',
        tool_calls: toolCalls,
      })

      // Execute each tool and collect results
      const step: AgenticStep = { iteration, tool_calls: toolCalls, tool_results: [] }

      for (const tc of toolCalls) {
        let toolResult: unknown
        try {
          toolResult = await toolExecutor(tc.function.name, tc.function.arguments)
          logger.info(`[LlmService] Tool "${tc.function.name}" executed successfully`)
        } catch (error) {
          toolResult = { error: error instanceof Error ? error.message : String(error) }
          logger.warn(`[LlmService] Tool "${tc.function.name}" failed: ${toolResult}`)
        }

        step.tool_results.push({ tool_call_id: tc.id, name: tc.function.name, result: toolResult })

        // Feed tool result back as a tool message
        messages.push({
          role: 'tool',
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          tool_call_id: tc.id,
        })
      }

      trace.push(step)
    }

    // Max iterations reached — return last assistant content
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    return {
      response: typeof lastAssistant?.content === 'string' ? lastAssistant.content : '',
      model: request.model,
      iterations: iteration,
      trace,
      finish_reason: 'max_iterations',
    }
  }

  // ---------------------------------------------------------------------------
  // Ollama implementation
  // ---------------------------------------------------------------------------

  private async _ollamaChat(request: LlmChatRequest): Promise<LlmChatChunk> {
    const ollamaMessages = request.messages.map(this._toOllamaMessage)
    const ollamaTools = request.tools?.map(this._toOllamaTool)

    const result = await this.ollamaService.chat({
      model: request.model,
      messages: ollamaMessages,
      ...(ollamaTools?.length ? { tools: ollamaTools } : {}),
      ...(request.think !== undefined ? { think: request.think as boolean } : {}),
    } as Parameters<OllamaService['chat']>[0])

    return {
      message: {
        role: result.message.role ?? 'assistant',
        content: result.message.content ?? '',
        tool_calls: result.message.tool_calls?.map(this._normaliseOllamaToolCall) ?? undefined,
      },
      done: result.done,
    }
  }

  private async *_ollamaChatStream(request: LlmChatRequest): AsyncGenerator<LlmChatChunk> {
    const ollamaMessages = request.messages.map(this._toOllamaMessage)
    const ollamaTools = request.tools?.map(this._toOllamaTool)

    const stream = await this.ollamaService.chatStream({
      model: request.model,
      messages: ollamaMessages,
      ...(ollamaTools?.length ? { tools: ollamaTools } : {}),
      ...(request.think !== undefined ? { think: request.think as boolean } : {}),
    } as Parameters<OllamaService['chatStream']>[0])

    for await (const chunk of stream) {
      yield {
        message: {
          role: chunk.message?.role ?? 'assistant',
          content: chunk.message?.content ?? '',
          tool_calls: chunk.message?.tool_calls?.map(this._normaliseOllamaToolCall) ?? undefined,
        },
        done: chunk.done ?? false,
      }
    }
  }

  /**
   * Convert an LlmMessage to an Ollama SDK Message.
   * Multimodal images are extracted from content-array parts into `.images`.
   */
  private _toOllamaMessage(msg: LlmMessage): OllamaMessage {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls.map((tc) => ({
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })) } : {}),
      } as OllamaMessage
    }

    // Multimodal: extract text and images separately
    const textParts = msg.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    const imageParts = msg.content.filter(
      (p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url'
    )

    const textContent = textParts.map((p) => p.text).join('\n')
    const images = imageParts.map((p) => {
      const url = p.image_url.url
      // Strip data URI prefix if present: data:image/jpeg;base64,<data>
      const b64 = url.includes(',') ? url.split(',')[1] : url
      return b64
    })

    return {
      role: msg.role,
      content: textContent,
      ...(images.length ? { images } : {}),
    } as OllamaMessage
  }

  private _toOllamaTool(tool: LlmTool): OllamaTool {
    return {
      type: tool.type,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters as OllamaTool['function']['parameters'],
      },
    }
  }

  /**
   * Normalise an Ollama ToolCall (no id, object args) to the canonical LlmToolCall.
   * Ollama's arguments are already a parsed object — no JSON.parse needed.
   */
  private _normaliseOllamaToolCall(tc: OllamaToolCall): LlmToolCall {
    return {
      id: randomUUID(),
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments as Record<string, unknown>,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // OpenRouter implementation
  // ---------------------------------------------------------------------------

  private _openRouterBaseUrl(): string {
    return env.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1'
  }

  private _openRouterHeaders() {
    return {
      Authorization: `Bearer ${env.get('OPENROUTER_API_KEY') ?? ''}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://projectnomad.us',
      'X-Title': 'Project NOMAD',
    }
  }

  /**
   * If the caller passes a plain Ollama-style name (e.g. "llama3.2:3b") when
   * OpenRouter is active, fall back to the configured default or vision model.
   * Requests containing image/video parts automatically use the vision model.
   */
  private _resolveOpenRouterModel(requestedModel: string, hasMedia = false): string {
    if (hasMedia) {
      const vision = env.get('OPENROUTER_VISION_MODEL') ?? env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o'
      return vision
    }
    const defaultModel = env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini'
    if (!requestedModel || !requestedModel.includes('/')) return defaultModel
    return requestedModel
  }

  /** Build the OpenRouter-compatible messages array. Multimodal content passes through as-is. */
  private _toOpenRouterMessages(messages: LlmMessage[]): unknown[] {
    return messages.map((msg) => {
      const base: Record<string, unknown> = { role: msg.role }

      if (msg.tool_call_id) base.tool_call_id = msg.tool_call_id

      if (msg.tool_calls) {
        base.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            // OpenRouter expects arguments as a JSON string
            arguments: JSON.stringify(tc.function.arguments),
          },
        }))
      }

      // Content: string → plain string; array → OpenAI content array.
      // video_url parts are converted to image_url (Gemini-style accepts this).
      if (typeof msg.content === 'string') {
        base.content = msg.content
      } else {
        base.content = msg.content.map((part) => {
          if (part.type === 'video_url') {
            return { type: 'image_url', image_url: { url: part.video_url.url } }
          }
          return part
        })
      }

      return base
    })
  }

  private _hasMedia(messages: LlmMessage[]): boolean {
    return messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p.type === 'image_url' || p.type === 'video_url')
    )
  }

  private async _openRouterChat(request: LlmChatRequest): Promise<LlmChatChunk> {
    const hasMedia = this._hasMedia(request.messages)
    const model = this._resolveOpenRouterModel(request.model, hasMedia)
    const messages = this._toOpenRouterMessages(request.messages)

    const body: Record<string, unknown> = { model, messages, stream: false }
    if (request.tools?.length) {
      body.tools = request.tools
      body.tool_choice = request.tool_choice ?? 'auto'
    }

    const response = await axios.post(
      `${this._openRouterBaseUrl()}/chat/completions`,
      body,
      { headers: this._openRouterHeaders() }
    )

    const choice = response.data.choices?.[0]
    if (!choice) throw new Error('[LlmService] OpenRouter returned no choices')

    const rawToolCalls: LlmToolCall[] | undefined = choice.message.tool_calls?.map(
      (tc: { id: string; type: string; function: { name: string; arguments: string } }) => ({
        id: tc.id ?? randomUUID(),
        type: 'function' as const,
        function: {
          name: tc.function.name,
          // OpenRouter returns arguments as a JSON string — parse it
          arguments: (() => {
            try { return JSON.parse(tc.function.arguments) }
            catch { return {} }
          })(),
        },
      })
    )

    return {
      message: {
        role: choice.message.role ?? 'assistant',
        content: choice.message.content ?? '',
        ...(rawToolCalls?.length ? { tool_calls: rawToolCalls } : {}),
      },
      done: true,
    }
  }

  private async *_openRouterChatStream(request: LlmChatRequest): AsyncGenerator<LlmChatChunk> {
    const hasMedia = this._hasMedia(request.messages)
    const model = this._resolveOpenRouterModel(request.model, hasMedia)
    const messages = this._toOpenRouterMessages(request.messages)

    const body: Record<string, unknown> = { model, messages, stream: true }
    if (request.tools?.length) {
      body.tools = request.tools
      body.tool_choice = request.tool_choice ?? 'auto'
    }

    let response: Awaited<ReturnType<typeof axios.post>>
    try {
      response = await axios.post(
        `${this._openRouterBaseUrl()}/chat/completions`,
        body,
        { headers: this._openRouterHeaders(), responseType: 'stream' }
      )
    } catch (error) {
      logger.error(`[LlmService] OpenRouter stream request failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }

    // Accumulate streaming tool_call argument fragments (OpenAI delta protocol)
    const pendingToolCalls: Record<number, {
      id: string; type: string
      function: { name: string; arguments: string }
    }> = {}

    let buffer = ''
    for await (const raw of response.data as AsyncIterable<Buffer>) {
      buffer += raw.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          yield { message: { role: 'assistant', content: '' }, done: true }
          return
        }

        let parsed: {
          choices?: {
            delta?: {
              role?: string
              content?: string
              tool_calls?: { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[]
            }
            finish_reason?: string | null
          }[]
        }
        try { parsed = JSON.parse(payload) } catch { continue }

        const delta = parsed.choices?.[0]?.delta
        const finishReason = parsed.choices?.[0]?.finish_reason

        // Accumulate tool_call argument fragments
        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: tcDelta.id ?? randomUUID(), type: 'function', function: { name: '', arguments: '' } }
            }
            if (tcDelta.id) pendingToolCalls[idx].id = tcDelta.id
            if (tcDelta.function?.name) pendingToolCalls[idx].function.name += tcDelta.function.name
            if (tcDelta.function?.arguments) pendingToolCalls[idx].function.arguments += tcDelta.function.arguments
          }
        }

        // Emit tool_calls chunk when the model is done calling tools
        if (finishReason === 'tool_calls') {
          const resolvedToolCalls: LlmToolCall[] = Object.values(pendingToolCalls).map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: (() => {
                try { return JSON.parse(tc.function.arguments) } catch { return {} }
              })(),
            },
          }))
          yield {
            message: { role: 'assistant', content: '', tool_calls: resolvedToolCalls },
            done: true,
          }
          return
        }

        if (delta && (delta.content !== undefined || delta.role !== undefined)) {
          yield {
            message: {
              role: delta.role ?? 'assistant',
              content: delta.content ?? '',
            },
            done: finishReason === 'stop',
          }
        }
      }
    }
  }
}
