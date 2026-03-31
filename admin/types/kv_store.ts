
export const KV_STORE_SCHEMA = {
  'chat.suggestionsEnabled':            'boolean',
  'chat.lastModel':                     'string',
  'rag.docsEmbedded':                   'boolean',
  'system.updateAvailable':             'boolean',
  'system.latestVersion':               'string',
  'system.earlyAccess':                 'boolean',
  'ui.hasVisitedEasySetup':             'boolean',
  'ui.theme':                           'string',
  'ai.assistantCustomName':             'string',
  'gpu.type':                           'string',
  // External AI provider settings
  'ai.chatProvider':                    'string',  // 'ollama' | 'openai_compatible'
  'ai.externalApiKey':                  'string',
  'ai.externalApiBaseUrl':              'string',
  'ai.externalChatModel':               'string',
  'ai.embeddingProvider':               'string',  // 'ollama' | 'openai_compatible'
  'ai.externalEmbeddingApiKey':         'string',
  'ai.externalEmbeddingApiBaseUrl':     'string',
  'ai.externalEmbeddingModel':          'string',
  'ai.externalEmbeddingDimension':      'string',
} as const

type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
