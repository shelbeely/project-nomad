import { LlmService } from '#services/llm_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'

/**
 * OpenAI-compatible proxy controller.
 *
 * Exposes the two endpoints most commonly required by LangChain, AutoGen,
 * and any framework that accepts an OpenAI-compatible base URL:
 *
 *   GET  /v1/models                — list available models
 *   POST /v1/chat/completions      — chat completion (streaming SSE supported)
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
      messages?: { role: string; content: string }[]
      stream?: boolean
      temperature?: number
      max_tokens?: number
    }

    const model = body.model ?? 'llama3.2:3b'
    const messages = (body.messages ?? []).filter(
      (m): m is { role: 'system' | 'user' | 'assistant'; content: string } =>
        ['system', 'user', 'assistant'].includes(m.role)
    )
    const stream = body.stream === true
    const completionId = `chatcmpl-${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)

    if (!messages.length) {
      return response.status(400).json({
        error: { message: 'messages array is required and must not be empty', type: 'invalid_request_error' },
      })
    }

    // ── Streaming ──────────────────────────────────────────────────────────
    if (stream) {
      response.response.setHeader('Content-Type', 'text/event-stream')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Connection', 'keep-alive')
      response.response.flushHeaders()

      try {
        const chunks = this.llmService.chatStream({ model, messages })
        for await (const chunk of chunks) {
          const content = chunk.message?.content ?? ''
          const isDone = chunk.done === true

          const openaiChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content },
                finish_reason: isDone ? 'stop' : null,
              },
            ],
          }
          response.response.write(`data: ${JSON.stringify(openaiChunk)}\n\n`)

          if (isDone) break
        }
      } catch (error) {
        logger.error(
          `[OpenAiCompatController] Streaming error: ${error instanceof Error ? error.message : error}`
        )
        const errChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop', error: true }],
        }
        response.response.write(`data: ${JSON.stringify(errChunk)}\n\n`)
      }

      response.response.write('data: [DONE]\n\n')
      response.response.end()
      return
    }

    // ── Non-streaming ──────────────────────────────────────────────────────
    const result = await this.llmService.chat({ model, messages })
    const content = result.message?.content ?? ''
    const promptTokens = Math.ceil(
      messages.reduce((acc, m) => acc + m.content.length, 0) / 4
    )
    const completionTokens = Math.ceil(content.length / 4)

    return {
      id: completionId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
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
