import { LlmService } from '#services/llm_service'
import type { LlmMessage, LlmTool } from '#services/llm_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'

/** Parse tool-call argument JSON strings, logging a warning on failure. */
function safeParseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch (err) {
    logger.warn({ err, raw }, 'OpenAiCompatController: failed to parse tool-call arguments')
    return {}
  }
}

/**
 * OpenAI-compatible proxy controller.
 *
 * Exposes the two endpoints most commonly required by LangChain, AutoGen,
 * and any framework that accepts an OpenAI-compatible base URL:
 *
 *   GET  /v1/models                — list available models
 *   POST /v1/chat/completions      — chat completion (streaming SSE supported)
 *
 * Supported features:
 *   - Text, image (base64 or URL), and video content parts (multimodal)
 *   - Tool / function calling with tool_calls in response
 *   - Streaming with accumulated tool_call delta frames
 *
 * Requests are forwarded to the active LLM provider (Ollama or OpenRouter)
 * via LlmService and responses are normalized to OpenAI format so that
 * any AI agent or framework can use NOMAD as a drop-in LLM backend.
 */
@inject()
export default class OpenAiCompatController {
  constructor(private llmService: LlmService) {}

  /** GET /v1/models */
  async models(_ctx: HttpContext) {
    const installed = await this.llmService.getInstalledModels()
    const data = (installed ?? []).map((m) => ({
      id: m.name,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'nomad',
    }))
    return { object: 'list', data }
  }

  /** POST /v1/chat/completions */
  async chatCompletions({ request, response }: HttpContext) {
    const body = request.body() as {
      model?: string
      messages?: {
        role: string
        content: string | { type: string; text?: string; image_url?: { url: string; detail?: string }; video_url?: { url: string } }[]
        tool_call_id?: string
        tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
      }[]
      stream?: boolean
      tools?: { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
      tool_choice?: string | Record<string, unknown>
    }

    const model = body.model ?? 'llama3.2:3b'
    const stream = body.stream === true
    const completionId = `chatcmpl-${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)

    const rawMessages = body.messages ?? []
    if (!rawMessages.length) {
      return response.status(400).json({
        error: { message: 'messages array is required and must not be empty', type: 'invalid_request_error' },
      })
    }

    // Normalise messages to LlmMessage format
    const messages: LlmMessage[] = rawMessages
      .filter((m) => ['system', 'user', 'assistant', 'tool'].includes(m.role))
      .map((m) => {
        const base: LlmMessage = {
          role: m.role as LlmMessage['role'],
          content: m.content as LlmMessage['content'],
        }
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id
        if (m.tool_calls) {
          base.tool_calls = m.tool_calls.map((tc) => ({
            id: tc.id ?? randomUUID(),
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: safeParseToolArgs(tc.function.arguments),
            },
          }))
        }
        return base
      })

    const tools: LlmTool[] | undefined = body.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }))

    const toolChoice = typeof body.tool_choice === 'string'
      ? (body.tool_choice as 'none' | 'auto' | 'required')
      : 'auto'

    // ── Streaming ──────────────────────────────────────────────────────────
    if (stream) {
      response.response.setHeader('Content-Type', 'text/event-stream')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Connection', 'keep-alive')
      response.response.flushHeaders()

      try {
        const chunks = this.llmService.chatStream({ model, messages, tools, tool_choice: toolChoice })
        for await (const chunk of chunks) {
          const toolCalls = chunk.message?.tool_calls
          const content = chunk.message?.content ?? ''
          const isDone = chunk.done === true

          const openaiChunk: Record<string, unknown> = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: toolCalls?.length ? null : content,
                  ...(toolCalls?.length ? {
                    tool_calls: toolCalls.map((tc, idx) => ({
                      index: idx,
                      id: tc.id,
                      type: tc.type,
                      function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
                    })),
                  } : {}),
                },
                finish_reason: isDone ? (toolCalls?.length ? 'tool_calls' : 'stop') : null,
              },
            ],
          }
          response.response.write(`data: ${JSON.stringify(openaiChunk)}\n\n`)
          if (isDone) break
        }
      } catch (error) {
        logger.error(`[OpenAiCompatController] Streaming error: ${error instanceof Error ? error.message : error}`)
        response.response.write(`data: ${JSON.stringify({ error: true })}\n\n`)
      }

      response.response.write('data: [DONE]\n\n')
      response.response.end()
      return
    }

    // ── Non-streaming ──────────────────────────────────────────────────────
    const result = await this.llmService.chat({ model, messages, tools, tool_choice: toolChoice })
    const content = result.message?.content ?? ''
    const toolCalls = result.message?.tool_calls

    const promptTokens = Math.ceil(rawMessages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 100), 0) / 4)
    const completionTokens = Math.ceil(content.length / 4)

    return {
      id: completionId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: toolCalls?.length ? null : content,
            ...(toolCalls?.length ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: tc.type,
                function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
              })),
            } : {}),
          },
          finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }
  }
}
