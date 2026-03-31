import { ChatService } from '#services/chat_service'
import { OllamaService } from '#services/ollama_service'
import { ExternalApiService } from '#services/external_api_service'
import { RagService } from '#services/rag_service'
import { modelNameSchema } from '#validators/download'
import { chatSchema, getAvailableModelsSchema } from '#validators/ollama'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DEFAULT_QUERY_REWRITE_MODEL, RAG_CONTEXT_LIMITS, SYSTEM_PROMPTS } from '../../constants/ollama.js'
import logger from '@adonisjs/core/services/logger'
import type { Message } from 'ollama'
import KVStore from '#models/kv_store'

@inject()
export default class OllamaController {
  constructor(
    private chatService: ChatService,
    private ollamaService: OllamaService,
    private ragService: RagService,
    private externalApiService: ExternalApiService
  ) { }

  private async _isExternalChatProvider(): Promise<boolean> {
    const provider = (await KVStore.getValue('ai.chatProvider')) ?? 'ollama'
    return provider === 'openai_compatible'
  }

  async availableModels({ request }: HttpContext) {
    const reqData = await request.validateUsing(getAvailableModelsSchema)
    return await this.ollamaService.getAvailableModels({
      sort: reqData.sort,
      recommendedOnly: reqData.recommendedOnly,
      query: reqData.query || null,
      limit: reqData.limit || 15,
      force: reqData.force,
    })
  }

  async chat({ request, response }: HttpContext) {
    const reqData = await request.validateUsing(chatSchema)
    const isExternal = await this._isExternalChatProvider()

    // Flush SSE headers immediately so the client connection is open while
    // pre-processing (query rewriting, RAG lookup) runs in the background.
    if (reqData.stream) {
      response.response.setHeader('Content-Type', 'text/event-stream')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Connection', 'keep-alive')
      response.response.flushHeaders()
    }

    try {
      // If there are no system messages in the chat inject system prompts
      const hasSystemMessage = reqData.messages.some((msg) => msg.role === 'system')
      if (!hasSystemMessage) {
        const systemPrompt = {
          role: 'system' as const,
          content: SYSTEM_PROMPTS.default,
        }
        logger.debug('[OllamaController] Injecting system prompt')
        reqData.messages.unshift(systemPrompt)
      }

      // Query rewriting is only available when Ollama is the chat provider,
      // as it requires a locally installed rewrite model.
      let rewrittenQuery: string | null
      if (isExternal) {
        const lastUserMsg = [...reqData.messages].reverse().find((m) => m.role === 'user')
        rewrittenQuery = lastUserMsg?.content || null
      } else {
        rewrittenQuery = await this.rewriteQueryWithContext(reqData.messages)
      }

      logger.debug(`[OllamaController] Query for RAG: "${rewrittenQuery}"`)
      if (rewrittenQuery) {
        const relevantDocs = await this.ragService.searchSimilarDocuments(
          rewrittenQuery,
          5, // Top 5 most relevant chunks
          0.3 // Minimum similarity score of 0.3
        )

        logger.debug(`[RAG] Retrieved ${relevantDocs.length} relevant documents for query: "${rewrittenQuery}"`)

        // If relevant context is found, inject as a system message with adaptive limits
        if (relevantDocs.length > 0) {
          // Determine context budget based on model size
          const { maxResults, maxTokens } = this.getContextLimitsForModel(reqData.model)
          let trimmedDocs = relevantDocs.slice(0, maxResults)

          // Apply token cap if set (estimate ~4 chars per token)
          // Always include the first (most relevant) result — the cap only gates subsequent results
          if (maxTokens > 0) {
            const charCap = maxTokens * 4
            let totalChars = 0
            trimmedDocs = trimmedDocs.filter((doc, idx) => {
              totalChars += doc.text.length
              return idx === 0 || totalChars <= charCap
            })
          }

          logger.debug(
            `[RAG] Injecting ${trimmedDocs.length}/${relevantDocs.length} results (model: ${reqData.model}, maxResults: ${maxResults}, maxTokens: ${maxTokens || 'unlimited'})`
          )

          const contextText = trimmedDocs
            .map((doc, idx) => `[Context ${idx + 1}] (Relevance: ${(doc.score * 100).toFixed(1)}%)\n${doc.text}`)
            .join('\n\n')

          const systemMessage = {
            role: 'system' as const,
            content: SYSTEM_PROMPTS.rag_context(contextText),
          }

          // Insert system message at the beginning (after any existing system messages)
          const firstNonSystemIndex = reqData.messages.findIndex((msg) => msg.role !== 'system')
          const insertIndex = firstNonSystemIndex === -1 ? 0 : firstNonSystemIndex
          reqData.messages.splice(insertIndex, 0, systemMessage)
        }
      }

      // "Thinking" capability is only supported by local Ollama models
      let think: boolean | 'medium' = false
      if (!isExternal) {
        const thinkingCapability = await this.ollamaService.checkModelHasThinking(reqData.model)
        think = thinkingCapability ? (reqData.model.startsWith('gpt-oss') ? 'medium' : true) : false
      }

      // Separate sessionId from the Ollama request payload — Ollama rejects unknown fields
      const { sessionId, ...ollamaRequest } = reqData

      // Save user message to DB before streaming if sessionId provided
      let userContent: string | null = null
      if (sessionId) {
        const lastUserMsg = [...reqData.messages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg) {
          userContent = lastUserMsg.content
          await this.chatService.addMessage(sessionId, 'user', userContent)
        }
      }

      if (reqData.stream) {
        logger.debug(`[OllamaController] Initiating streaming response for model: "${reqData.model}" (provider: ${isExternal ? 'external' : 'ollama'})`)
        // Headers already flushed above
        let fullContent = ''

        if (isExternal) {
          for await (const chunk of this.externalApiService.chatStream(ollamaRequest.messages, reqData.model)) {
            if (chunk.message?.content) {
              fullContent += chunk.message.content
            }
            response.response.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
        } else {
          const stream = await this.ollamaService.chatStream({ ...ollamaRequest, think })
          for await (const chunk of stream) {
            if (chunk.message?.content) {
              fullContent += chunk.message.content
            }
            response.response.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
        }

        response.response.end()

        // Save assistant message and optionally generate title
        if (sessionId && fullContent) {
          await this.chatService.addMessage(sessionId, 'assistant', fullContent)
          const messageCount = await this.chatService.getMessageCount(sessionId)
          if (messageCount <= 2 && userContent) {
            this.chatService.generateTitle(sessionId, userContent, fullContent).catch((err) => {
              logger.error(`[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`)
            })
          }
        }
        return
      }

      // Non-streaming path
      const result = isExternal
        ? await this.externalApiService.chat(ollamaRequest.messages, reqData.model)
        : await this.ollamaService.chat({ ...ollamaRequest, think })

      if (sessionId && result?.message?.content) {
        await this.chatService.addMessage(sessionId, 'assistant', result.message.content)
        const messageCount = await this.chatService.getMessageCount(sessionId)
        if (messageCount <= 2 && userContent) {
          this.chatService.generateTitle(sessionId, userContent, result.message.content).catch((err) => {
            logger.error(`[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`)
          })
        }
      }

      return result
    } catch (error) {
      if (reqData.stream) {
        response.response.write(`data: ${JSON.stringify({ error: true })}\n\n`)
        response.response.end()
        return
      }
      throw error
    }
  }

  async deleteModel({ request, response }: HttpContext) {
    if (await this._isExternalChatProvider()) {
      return response.status(400).json({ success: false, message: 'Model management is not available when using an external AI provider.' })
    }
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.deleteModel(reqData.model)
    return {
      success: true,
      message: `Model deleted: ${reqData.model}`,
    }
  }

  async dispatchModelDownload({ request, response }: HttpContext) {
    if (await this._isExternalChatProvider()) {
      return response.status(400).json({ success: false, message: 'Model downloads are not available when using an external AI provider.' })
    }
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.dispatchModelDownload(reqData.model)
    return {
      success: true,
      message: `Download job dispatched for model: ${reqData.model}`,
    }
  }

  async installedModels({ }: HttpContext) {
    if (await this._isExternalChatProvider()) {
      const model = (await KVStore.getValue('ai.externalChatModel')) ?? ''
      if (!model) return []
      // Return a minimal ModelResponse-compatible object so the chat UI can populate the model selector
      return [{ name: model, model, modified_at: new Date(), size: 0, digest: '', details: {} }]
    }
    return await this.ollamaService.getModels()
  }

  /**
   * Determines RAG context limits based on model size extracted from the model name.
   * Parses size indicators like "1b", "3b", "8b", "70b" from model names/tags.
   */
  private getContextLimitsForModel(modelName: string): { maxResults: number; maxTokens: number } {
    // Extract parameter count from model name (e.g., "llama3.2:3b", "qwen2.5:1.5b", "gemma:7b")
    const sizeMatch = modelName.match(/(\d+\.?\d*)[bB]/)
    const paramBillions = sizeMatch ? parseFloat(sizeMatch[1]) : 8 // default to 8B if unknown

    for (const tier of RAG_CONTEXT_LIMITS) {
      if (paramBillions <= tier.maxParams) {
        return { maxResults: tier.maxResults, maxTokens: tier.maxTokens }
      }
    }

    // Fallback: no limits
    return { maxResults: 5, maxTokens: 0 }
  }

  private async rewriteQueryWithContext(
    messages: Message[]
  ): Promise<string | null> {
    try {
      // Get recent conversation history (last 6 messages for 3 turns)
      const recentMessages = messages.slice(-6)

      // Skip rewriting for short conversations. Rewriting adds latency with
      // little RAG benefit until there is enough context to matter.
      const userMessages = recentMessages.filter(msg => msg.role === 'user')
      if (userMessages.length <= 2) {
        return userMessages[userMessages.length - 1]?.content || null
      }

      const conversationContext = recentMessages
        .map(msg => {
          const role = msg.role === 'user' ? 'User' : 'Assistant'
          // Truncate assistant messages to first 200 chars to keep context manageable
          const content = msg.role === 'assistant'
            ? msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')
            : msg.content
          return `${role}: "${content}"`
        })
        .join('\n')

      const installedModels = await this.ollamaService.getModels(true)
      const rewriteModelAvailable = installedModels?.some(model => model.name === DEFAULT_QUERY_REWRITE_MODEL)
      if (!rewriteModelAvailable) {
        logger.warn(`[RAG] Query rewrite model "${DEFAULT_QUERY_REWRITE_MODEL}" not available. Skipping query rewriting.`)
        const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user')
        return lastUserMessage?.content || null
      }

      // FUTURE ENHANCEMENT: allow the user to specify which model to use for rewriting
      const response = await this.ollamaService.chat({
        model: DEFAULT_QUERY_REWRITE_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPTS.query_rewrite,
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationContext}\n\nRewritten Query:`,
          },
        ],
      })

      const rewrittenQuery = response.message.content.trim()
      logger.info(`[RAG] Query rewritten: "${rewrittenQuery}"`)
      return rewrittenQuery
    } catch (error) {
      logger.error(
        `[RAG] Query rewriting failed: ${error instanceof Error ? error.message : error}`
      )
      // Fallback to last user message if rewriting fails
      const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user')
      return lastUserMessage?.content || null
    }
  }
}
