import { KVStoreKey } from "../types/kv_store.js";

export const SETTINGS_KEYS: KVStoreKey[] = [
  'chat.suggestionsEnabled',
  'chat.lastModel',
  'ui.hasVisitedEasySetup',
  'ui.theme',
  'system.earlyAccess',
  'ai.assistantCustomName',
  'ai.chatProvider',
  'ai.externalApiKey',
  'ai.externalApiBaseUrl',
  'ai.externalChatModel',
  'ai.embeddingProvider',
  'ai.externalEmbeddingApiKey',
  'ai.externalEmbeddingApiBaseUrl',
  'ai.externalEmbeddingModel',
  'ai.externalEmbeddingDimension',
];