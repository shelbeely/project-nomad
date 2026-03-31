import { inject } from '@adonisjs/core'
import { OllamaService } from './ollama_service.js'
import env from '#start/env'
import axios from 'axios'
import logger from '@adonisjs/core/services/logger'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../constants/ollama.js'

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmChatRequest = {
  model: string
  messages: LlmMessage[]
  stream?: boolean
  think?: boolean | string
}

export type LlmChatChunk = {
  message: { role: string; content: string }
  done: boolean
}

/**
 * Provider-agnostic LLM service.
 *
 * Reads AI_PROVIDER from the environment:
 *  - 'ollama'      → delegates to local OllamaService (default, fully offline)
 *  - 'openrouter'  → calls OpenRouter's OpenAI-compatible API
 *
 * Embeddings (used by RagService) always go through local Ollama regardless
 * of this setting.
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
   * The model name to use for query rewriting (contextual RAG lookup).
   * For Ollama this is a small local model; for OpenRouter it falls back to
   * the configured default model.
   */
  getRewriteModel(): string {
    if (this.isOllamaProvider()) {
      return DEFAULT_QUERY_REWRITE_MODEL
    }
    return env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini'
  }

  /**
   * Check whether the rewrite model is available for use.
   * For Ollama we verify the model is installed locally.
   * For OpenRouter we assume the model is always accessible.
   */
  async isRewriteModelAvailable(): Promise<boolean> {
    if (!this.isOllamaProvider()) {
      return true
    }
    const installed = await this.ollamaService.getModels(true)
    return installed?.some((m) => m.name === DEFAULT_QUERY_REWRITE_MODEL) ?? false
  }

  /**
   * Check whether the given model supports extended "thinking" capability.
   * OpenRouter does not expose this flag, so we return false.
   */
  async checkModelHasThinking(model: string): Promise<boolean> {
    if (!this.isOllamaProvider()) {
      return false
    }
    return this.ollamaService.checkModelHasThinking(model)
  }

  /**
   * Non-streaming chat completion. Returns the assistant message and a done flag.
   */
  async chat(request: LlmChatRequest): Promise<LlmChatChunk> {
    if (this.isOllamaProvider()) {
      const result = await this.ollamaService.chat(request as Parameters<OllamaService['chat']>[0])
      return { message: result.message as { role: string; content: string }, done: true }
    }
    return this._openRouterChat(request)
  }

  /**
   * Streaming chat completion. Yields normalized chunks in Ollama-compatible
   * format so the controller can treat both providers identically.
   */
  async *chatStream(request: LlmChatRequest): AsyncGenerator<LlmChatChunk> {
    if (this.isOllamaProvider()) {
      const stream = await this.ollamaService.chatStream(
        request as Parameters<OllamaService['chatStream']>[0]
      )
      for await (const chunk of stream) {
        yield chunk as unknown as LlmChatChunk
      }
      return
    }
    yield* this._openRouterChatStream(request)
  }

  /**
   * Return installed / accessible models.
   * For Ollama: returns locally installed models.
   * For OpenRouter: returns a single synthetic entry for the configured model.
   */
  async getInstalledModels(includeEmbeddings = false) {
    if (this.isOllamaProvider()) {
      return this.ollamaService.getModels(includeEmbeddings)
    }
    const modelName = env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini'
    return [
      {
        name: modelName,
        model: modelName,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: '',
        details: {
          family: 'openrouter',
          parameter_size: 'unknown',
          quantization_level: 'none',
        },
      },
    ]
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

  private _resolveOpenRouterModel(requestedModel: string): string {
    // If the caller passes a plain Ollama-style name (e.g. "llama3.2:3b") when
    // OpenRouter is active, fall back to the configured default model so that
    // the request doesn't fail.
    const defaultModel = env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini'
    if (!requestedModel || !requestedModel.includes('/')) {
      return defaultModel
    }
    return requestedModel
  }

  private async _openRouterChat(request: LlmChatRequest): Promise<LlmChatChunk> {
    const model = this._resolveOpenRouterModel(request.model)
    const response = await axios.post(
      `${this._openRouterBaseUrl()}/chat/completions`,
      { model, messages: request.messages, stream: false },
      { headers: this._openRouterHeaders() }
    )
    const choice = response.data.choices?.[0]
    if (!choice) {
      throw new Error('[LlmService] OpenRouter returned no choices')
    }
    return {
      message: { role: choice.message.role ?? 'assistant', content: choice.message.content ?? '' },
      done: true,
    }
  }

  private async *_openRouterChatStream(request: LlmChatRequest): AsyncGenerator<LlmChatChunk> {
    const model = this._resolveOpenRouterModel(request.model)
    let response: Awaited<ReturnType<typeof axios.post>>
    try {
      response = await axios.post(
        `${this._openRouterBaseUrl()}/chat/completions`,
        { model, messages: request.messages, stream: true },
        { headers: this._openRouterHeaders(), responseType: 'stream' }
      )
    } catch (error) {
      logger.error(
        `[LlmService] OpenRouter stream request failed: ${error instanceof Error ? error.message : error}`
      )
      throw error
    }

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
        try {
          const parsed = JSON.parse(payload)
          const delta = parsed.choices?.[0]?.delta
          if (delta !== undefined) {
            yield {
              message: {
                role: delta.role ?? 'assistant',
                content: delta.content ?? '',
              },
              done: parsed.choices?.[0]?.finish_reason === 'stop',
            }
          }
        } catch {
          // Skip malformed SSE frames
        }
      }
    }
  }
}
