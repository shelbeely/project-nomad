import KVStore from '#models/kv_store'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import type { Message } from 'ollama'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const OPENAI_EMBEDDING_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_EXTERNAL_EMBEDDING_MODEL = 'text-embedding-3-small'
export const DEFAULT_EXTERNAL_EMBEDDING_DIMENSION = 1536

export interface ExternalChatChunk {
  message: { content: string; thinking: string }
  done: boolean
}

export interface ExternalChatResponse {
  message: { content: string }
}

/**
 * Service for communicating with OpenAI-compatible external AI APIs.
 * Covers chat inference and embeddings, and is compatible with OpenRouter,
 * OpenAI, and any provider that implements the OpenAI REST API.
 */
@inject()
export class ExternalApiService {
  async getChatConfig() {
    const apiKey = (await KVStore.getValue('ai.externalApiKey')) ?? ''
    const baseUrl = ((await KVStore.getValue('ai.externalApiBaseUrl')) ?? '').trim() || OPENROUTER_BASE_URL
    const model = (await KVStore.getValue('ai.externalChatModel')) ?? ''
    return { apiKey, baseUrl, model }
  }

  async getEmbeddingConfig() {
    const chatApiKey = (await KVStore.getValue('ai.externalApiKey')) ?? ''
    const chatBaseUrl = ((await KVStore.getValue('ai.externalApiBaseUrl')) ?? '').trim() || OPENROUTER_BASE_URL

    const apiKey = ((await KVStore.getValue('ai.externalEmbeddingApiKey')) ?? '').trim() || chatApiKey
    const baseUrl = ((await KVStore.getValue('ai.externalEmbeddingApiBaseUrl')) ?? '').trim() || chatBaseUrl
    const model = ((await KVStore.getValue('ai.externalEmbeddingModel')) ?? '').trim() || DEFAULT_EXTERNAL_EMBEDDING_MODEL
    const dimensionStr = (await KVStore.getValue('ai.externalEmbeddingDimension')) ?? ''
    const dimension = parseInt(dimensionStr, 10) || DEFAULT_EXTERNAL_EMBEDDING_DIMENSION
    return { apiKey, baseUrl, model, dimension }
  }

  async chat(messages: Message[], model?: string): Promise<ExternalChatResponse> {
    const config = await this.getChatConfig()
    const targetModel = model || config.model
    if (!targetModel) {
      throw new Error('No chat model configured. Please set a model in AI Provider settings.')
    }

    const url = `${config.baseUrl}/chat/completions`
    logger.debug(`[ExternalApiService] Non-streaming chat to ${url} with model "${targetModel}"`)

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`External API error ${resp.status}: ${errBody}`)
    }

    const data = (await resp.json()) as any
    return {
      message: {
        content: data.choices?.[0]?.message?.content ?? '',
      },
    }
  }

  async *chatStream(messages: Message[], model?: string): AsyncGenerator<ExternalChatChunk> {
    const config = await this.getChatConfig()
    const targetModel = model || config.model
    if (!targetModel) {
      throw new Error('No chat model configured. Please set a model in AI Provider settings.')
    }

    const url = `${config.baseUrl}/chat/completions`
    logger.debug(`[ExternalApiService] Streaming chat to ${url} with model "${targetModel}"`)

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    })

    if (!resp.ok || !resp.body) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`External API stream error ${resp.status}: ${errBody}`)
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const reader = resp.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const rawData = line.slice(6).trim()

          if (rawData === '[DONE]') {
            yield { message: { content: '', thinking: '' }, done: true }
            return
          }

          let parsed: any
          try {
            parsed = JSON.parse(rawData)
          } catch {
            continue
          }

          const content: string = parsed.choices?.[0]?.delta?.content ?? ''
          const finishReason: string | null = parsed.choices?.[0]?.finish_reason ?? null

          if (content || finishReason !== null) {
            yield { message: { content, thinking: '' }, done: finishReason !== null }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const config = await this.getEmbeddingConfig()
    const url = `${config.baseUrl}/embeddings`
    logger.debug(`[ExternalApiService] Embedding ${texts.length} texts via ${url}`)

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: texts,
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`External embedding API error ${resp.status}: ${errBody}`)
    }

    const data = (await resp.json()) as any
    // OpenAI format: { data: [{ index: number, embedding: number[] }] }
    const items: Array<{ index: number; embedding: number[] }> = data.data || []
    items.sort((a, b) => a.index - b.index)
    return items.map((item) => item.embedding)
  }

  async listModels(): Promise<Array<{ id: string }>> {
    try {
      const config = await this.getChatConfig()
      const resp = await fetch(`${config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      if (!resp.ok) return []
      const data = (await resp.json()) as any
      return (data.data as Array<{ id: string }>) || []
    } catch (error) {
      logger.error(
        `[ExternalApiService] Failed to list models: ${error instanceof Error ? error.message : error}`
      )
      return []
    }
  }
}
