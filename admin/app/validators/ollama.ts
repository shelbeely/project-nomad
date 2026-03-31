import vine from '@vinejs/vine'

export const chatSchema = vine.compile(
  vine.object({
    model: vine.string().trim().minLength(1),
    messages: vine.array(
      vine.object({
        role: vine.enum(['system', 'user', 'assistant', 'tool'] as const),
        // Accept plain string or a multimodal content array (image_url, video_url, text parts)
        content: vine.any(),
        tool_call_id: vine.string().optional(),
        tool_calls: vine.any().optional(),
      })
    ),
    stream: vine.boolean().optional(),
    sessionId: vine.number().positive().optional(),
    tools: vine.any().optional(),
    tool_choice: vine.any().optional(),
  })
)

export const getAvailableModelsSchema = vine.compile(
  vine.object({
    sort: vine.enum(['pulls', 'name'] as const).optional(),
    recommendedOnly: vine.boolean().optional(),
    query: vine.string().trim().optional(),
    limit: vine.number().positive().optional(),
    force: vine.boolean().optional(),
  })
)
