import { ChatService } from '#services/chat_service'
import { LlmService } from '#services/llm_service'
import type { LlmMessage, LlmContentPart } from '#services/llm_service'
import { OllamaService } from '#services/ollama_service'
import { RagService } from '#services/rag_service'
import { modelNameSchema } from '#validators/download'
import { chatSchema, getAvailableModelsSchema } from '#validators/ollama'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RAG_CONTEXT_LIMITS, SYSTEM_PROMPTS } from '../../constants/ollama.js'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class OllamaController {
  constructor(
    private chatService: ChatService,
    private ollamaService: OllamaService,
    private ragService: RagService,
    private llmService: LlmService
  ) { }

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
    // VineJS infers vine.any() content as optional-any; cast once to the stricter
    // LlmMessage type that all downstream services expect. Content is always
    // present at runtime because the API contract requires it.
    const typedMessages = reqData.messages as unknown as LlmMessage[]

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
      const hasSystemMessage = typedMessages.some((msg) => msg.role === 'system')
      if (!hasSystemMessage) {
        const systemPrompt: LlmMessage = {
          role: 'system',
          content: SYSTEM_PROMPTS.default,
        }
        logger.debug('[OllamaController] Injecting system prompt')
        typedMessages.unshift(systemPrompt)
      }

      // Query rewriting for better RAG retrieval with manageable context
      // Will return user's latest message if no rewriting is needed
      const rewrittenQuery = await this.rewriteQueryWithContext(typedMessages)

      logger.debug(`[OllamaController] Rewritten query for RAG: "${rewrittenQuery}"`)
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

          const systemMessage: LlmMessage = {
            role: 'system',
            content: SYSTEM_PROMPTS.rag_context(contextText),
          }

          // Insert system message at the beginning (after any existing system messages)
          const firstNonSystemIndex = typedMessages.findIndex((msg) => msg.role !== 'system')
          const insertIndex = firstNonSystemIndex === -1 ? 0 : firstNonSystemIndex
          typedMessages.splice(insertIndex, 0, systemMessage)
        }
      }

      // Check if the model supports "thinking" capability for enhanced response generation
      // If gpt-oss model, it requires a text param for "think" https://docs.ollama.com/api/chat
      const thinkingCapability = await this.llmService.checkModelHasThinking(reqData.model)
      const think: boolean | 'medium' = thinkingCapability ? (reqData.model.startsWith('gpt-oss') ? 'medium' : true) : false

      // Build the typed LLM payload (sessionId is not passed to the LLM service)
      const chatPayload = {
        model: reqData.model,
        messages: typedMessages,
        stream: reqData.stream,
        tools: reqData.tools,
        tool_choice: reqData.tool_choice,
      }

      // Save user message to DB before streaming if sessionId provided
      let userContent: string | null = null
      const sessionId = reqData.sessionId
      if (sessionId) {
        const lastUserMsg = [...typedMessages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg) {
          userContent = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '[multimodal message]'
          await this.chatService.addMessage(sessionId, 'user', userContent)
        }
      }

      if (reqData.stream) {
        logger.debug(`[OllamaController] Initiating streaming response for model: "${reqData.model}" with think: ${think}`)
        // Headers already flushed above
        const stream = this.llmService.chatStream({ ...chatPayload, think })
        let fullContent = ''
        for await (const chunk of stream) {
          if (chunk.message?.content) {
            fullContent += chunk.message.content
          }
          response.response.write(`data: ${JSON.stringify(chunk)}\n\n`)
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

      // Non-streaming path — includes tool_calls if model requested them
      const result = await this.llmService.chat({ ...chatPayload, think })

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

  async deleteModel({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.deleteModel(reqData.model)
    return {
      success: true,
      message: `Model deleted: ${reqData.model}`,
    }
  }

  async dispatchModelDownload({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.dispatchModelDownload(reqData.model)
    return {
      success: true,
      message: `Download job dispatched for model: ${reqData.model}`,
    }
  }

  async installedModels({ }: HttpContext) {
    return await this.llmService.getInstalledModels()
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
    messages: LlmMessage[]
  ): Promise<string | null> {
    // Extract plain text from a message that may carry multimodal content parts
    const textOf = (content: string | LlmContentPart[]): string => {
      if (typeof content === 'string') return content
      return content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join(' ')
    }

    try {
      // Get recent conversation history (last 6 messages for 3 turns)
      const recentMessages = messages.slice(-6)

      // Skip rewriting for short conversations. Rewriting adds latency with
      // little RAG benefit until there is enough context to matter.
      const userMessages = recentMessages.filter(msg => msg.role === 'user')
      if (userMessages.length <= 2) {
        const last = userMessages[userMessages.length - 1]
        return last ? textOf(last.content) || null : null
      }

      const conversationContext = recentMessages
        .map(msg => {
          const role = msg.role === 'user' ? 'User' : 'Assistant'
          // Truncate assistant messages to first 200 chars to keep context manageable
          const raw = textOf(msg.content)
          const content = msg.role === 'assistant'
            ? raw.slice(0, 200) + (raw.length > 200 ? '...' : '')
            : raw
          return `${role}: "${content}"`
        })
        .join('\n')

      const rewriteModelAvailable = await this.llmService.isRewriteModelAvailable()
      if (!rewriteModelAvailable) {
        const rewriteModel = this.llmService.getRewriteModel()
        logger.warn(`[RAG] Query rewrite model "${rewriteModel}" not available. Skipping query rewriting.`)
        const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user')
        return lastUserMessage ? textOf(lastUserMessage.content) || null : null
      }

      const rewriteModel = this.llmService.getRewriteModel()

      // FUTURE ENHANCEMENT: allow the user to specify which model to use for rewriting
      const response = await this.llmService.chat({
        model: rewriteModel,
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
      return lastUserMessage ? textOf(lastUserMessage.content) || null : null
    }
  }
}
