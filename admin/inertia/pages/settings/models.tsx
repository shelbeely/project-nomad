import { Head, router, usePage } from '@inertiajs/react'
import { useRef, useState } from 'react'
import StyledTable from '~/components/StyledTable'
import SettingsLayout from '~/layouts/SettingsLayout'
import { NomadOllamaModel } from '../../../types/ollama'
import StyledButton from '~/components/StyledButton'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import Alert from '~/components/Alert'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import { useModals } from '~/context/ModalContext'
import StyledModal from '~/components/StyledModal'
import { ModelResponse } from 'ollama'
import { SERVICE_NAMES } from '../../../constants/service_names'
import Switch from '~/components/inputs/Switch'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { useMutation, useQuery } from '@tanstack/react-query'
import Input from '~/components/inputs/Input'
import { IconSearch, IconRefresh } from '@tabler/icons-react'
import useDebounce from '~/hooks/useDebounce'
import ActiveModelDownloads from '~/components/ActiveModelDownloads'
import { useSystemInfo } from '~/hooks/useSystemInfo'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

interface ProviderSettings {
  chatProvider: string
  externalApiKey: string
  externalApiBaseUrl: string
  externalChatModel: string
  embeddingProvider: string
  externalEmbeddingApiKey: string
  externalEmbeddingApiBaseUrl: string
  externalEmbeddingModel: string
  externalEmbeddingDimension: string
}

export default function ModelsPage(props: {
  models: {
    availableModels: NomadOllamaModel[]
    installedModels: ModelResponse[]
    settings: {
      chatSuggestionsEnabled: boolean
      aiAssistantCustomName: string
    } & ProviderSettings
  }
}) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { isInstalled } = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)
  const { addNotification } = useNotifications()
  const { openModal, closeAllModals } = useModals()
  const { debounce } = useDebounce()
  const { data: systemInfo } = useSystemInfo({})

  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('nomad:gpu-banner-dismissed') === 'true'
    } catch {
      return false
    }
  })
  const [reinstalling, setReinstalling] = useState(false)

  // Provider settings state
  const [chatProvider, setChatProvider] = useState(props.models.settings.chatProvider || 'ollama')
  const [externalApiKey, setExternalApiKey] = useState(props.models.settings.externalApiKey || '')
  const [externalApiBaseUrl, setExternalApiBaseUrl] = useState(props.models.settings.externalApiBaseUrl || '')
  const [externalChatModel, setExternalChatModel] = useState(props.models.settings.externalChatModel || '')
  const [embeddingProvider, setEmbeddingProvider] = useState(props.models.settings.embeddingProvider || 'ollama')
  const [externalEmbeddingApiKey, setExternalEmbeddingApiKey] = useState(props.models.settings.externalEmbeddingApiKey || '')
  const [externalEmbeddingApiBaseUrl, setExternalEmbeddingApiBaseUrl] = useState(props.models.settings.externalEmbeddingApiBaseUrl || '')
  const [externalEmbeddingModel, setExternalEmbeddingModel] = useState(props.models.settings.externalEmbeddingModel || '')
  const [externalEmbeddingDimension, setExternalEmbeddingDimension] = useState(props.models.settings.externalEmbeddingDimension || '')

  const isExternalProvider = chatProvider === 'openai_compatible'

  const handleDismissGpuBanner = () => {
    setGpuBannerDismissed(true)
    try {
      localStorage.setItem('nomad:gpu-banner-dismissed', 'true')
    } catch {}
  }

  const handleForceReinstallOllama = () => {
    openModal(
      <StyledModal
        title="Reinstall AI Assistant?"
        onConfirm={async () => {
          closeAllModals()
          setReinstalling(true)
          try {
            const response = await api.forceReinstallService('nomad_ollama')
            if (!response || !response.success) {
              throw new Error(response?.message || 'Force reinstall failed')
            }
            addNotification({
              message: `${aiAssistantName} is being reinstalled with GPU support. This page will reload shortly.`,
              type: 'success',
            })
            try { localStorage.removeItem('nomad:gpu-banner-dismissed') } catch {}
            setTimeout(() => window.location.reload(), 5000)
          } catch (error) {
            addNotification({
              message: `Failed to reinstall: ${error instanceof Error ? error.message : 'Unknown error'}`,
              type: 'error',
            })
            setReinstalling(false)
          }
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Reinstall"
        cancelText="Cancel"
      >
        <p className="text-text-primary">
          This will recreate the {aiAssistantName} container with GPU support enabled.
          Your downloaded models will be preserved. The service will be briefly
          unavailable during reinstall.
        </p>
      </StyledModal>,
      'gpu-health-force-reinstall-modal'
    )
  }
  const [chatSuggestionsEnabled, setChatSuggestionsEnabled] = useState(
    props.models.settings.chatSuggestionsEnabled
  )
  const [aiAssistantCustomName, setAiAssistantCustomName] = useState(
    props.models.settings.aiAssistantCustomName
  )

  const [query, setQuery] = useState('')
  const [queryUI, setQueryUI] = useState('')
  const [limit, setLimit] = useState(15)

  const debouncedSetQuery = debounce((val: string) => {
    setQuery(val)
  }, 300)

  const forceRefreshRef = useRef(false)
  const [isForceRefreshing, setIsForceRefreshing] = useState(false)

  const { data: availableModelData, isFetching, refetch } = useQuery({
    queryKey: ['ollama', 'availableModels', query, limit],
    queryFn: async () => {
      const force = forceRefreshRef.current
      forceRefreshRef.current = false
      const res = await api.getAvailableModels({
        query,
        recommendedOnly: false,
        limit,
        force: force || undefined,
      })
      if (!res) {
        return {
          models: [],
          hasMore: false,
        }
      }
      return res
    },
    initialData: { models: props.models.availableModels, hasMore: false },
  })

  async function handleForceRefresh() {
    forceRefreshRef.current = true
    setIsForceRefreshing(true)
    await refetch()
    setIsForceRefreshing(false)
    addNotification({ message: 'Model list refreshed from remote.', type: 'success' })
  }

  async function handleInstallModel(modelName: string) {
    try {
      const res = await api.downloadModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model download initiated for ${modelName}. It may take some time to complete.`,
          type: 'success',
        })
      }
    } catch (error) {
      console.error('Error installing model:', error)
      addNotification({
        message: `There was an error installing the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function handleDeleteModel(modelName: string) {
    try {
      const res = await api.deleteModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model deleted: ${modelName}.`,
          type: 'success',
        })
      }
      closeAllModals()
      router.reload()
    } catch (error) {
      console.error('Error deleting model:', error)
      addNotification({
        message: `There was an error deleting the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function confirmDeleteModel(model: string) {
    openModal(
      <StyledModal
        title="Delete Model?"
        onConfirm={() => {
          handleDeleteModel(model)
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="primary"
      >
        <p className="text-text-primary">
          Are you sure you want to delete this model? You will need to download it again if you want
          to use it in the future.
        </p>
      </StyledModal>,
      'confirm-delete-model-modal'
    )
  }

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean | string }) => {
      return await api.updateSetting(key, value)
    },
    onSuccess: () => {
      addNotification({
        message: 'Setting updated successfully.',
        type: 'success',
      })
    },
    onError: (error) => {
      console.error('Error updating setting:', error)
      addNotification({
        message: 'There was an error updating the setting. Please try again.',
        type: 'error',
      })
    },
  })

  function saveSetting(key: string, value: string | boolean) {
    updateSettingMutation.mutate({ key, value })
  }

  return (
    <SettingsLayout>
      <Head title={`${aiAssistantName} Settings | Project N.O.M.A.D.`} />
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6">
          <h1 className="text-4xl font-semibold mb-4">{aiAssistantName}</h1>
          <p className="text-text-muted mb-4">
            Easily manage the {aiAssistantName}'s settings and installed models. We recommend
            starting with smaller models first to see how they perform on your system before moving
            on to larger ones.
          </p>
          {!isExternalProvider && !isInstalled && (
            <Alert
              title={`${aiAssistantName}'s dependencies are not installed. Please install them to manage AI models.`}
              type="warning"
              variant="solid"
              className="!mt-6"
            />
          )}
          {!isExternalProvider && isInstalled && systemInfo?.gpuHealth?.status === 'passthrough_failed' && !gpuBannerDismissed && (
            <Alert
              type="warning"
              variant="bordered"
              title="GPU Not Accessible"
              message={`Your system has an NVIDIA GPU, but ${aiAssistantName} can't access it. AI is running on CPU only, which is significantly slower.`}
              className="!mt-6"
              dismissible={true}
              onDismiss={handleDismissGpuBanner}
              buttonProps={{
                children: `Fix: Reinstall ${aiAssistantName}`,
                icon: 'IconRefresh',
                variant: 'action',
                size: 'sm',
                onClick: handleForceReinstallOllama,
                loading: reinstalling,
                disabled: reinstalling,
              }}
            />
          )}

          {/* AI Provider */}
          <StyledSectionHeader title="AI Provider" className="mt-8 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
            <div className="space-y-5">
              <div>
                <label className="block text-base/6 font-medium text-text-primary">Chat Provider</label>
                <p className="mt-1 text-sm text-text-muted">Choose where inference runs — locally via Ollama or via an external OpenAI-compatible API.</p>
                <select
                  value={chatProvider}
                  onChange={(e) => {
                    setChatProvider(e.target.value)
                    saveSetting('ai.chatProvider', e.target.value)
                  }}
                  className="mt-2 block w-full rounded-md bg-surface-primary px-3 py-2 text-base text-text-primary border border-border-default focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-primary sm:text-sm/6"
                >
                  <option value="ollama">Local (Ollama)</option>
                  <option value="openai_compatible">External API (OpenRouter, OpenAI, etc.)</option>
                </select>
              </div>

              {isExternalProvider && (
                <>
                  <div className="rounded-md bg-surface-secondary border border-border-subtle p-3 text-sm text-text-muted">
                    💡 For <strong className="text-text-primary">OpenRouter</strong>, set the Base URL to{' '}
                    <code className="font-mono text-xs bg-surface-primary px-1 py-0.5 rounded">{OPENROUTER_BASE_URL}</code> and get your API key at{' '}
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">openrouter.ai/keys</a>.
                  </div>
                  <Input
                    name="externalApiBaseUrl"
                    label="API Base URL"
                    helpText="Base URL of the OpenAI-compatible API endpoint."
                    placeholder={OPENROUTER_BASE_URL}
                    value={externalApiBaseUrl}
                    onChange={(e) => setExternalApiBaseUrl(e.target.value)}
                    onBlur={() => saveSetting('ai.externalApiBaseUrl', externalApiBaseUrl)}
                  />
                  <Input
                    name="externalApiKey"
                    label="API Key"
                    helpText="Your API key for the external provider."
                    placeholder="sk-..."
                    type="password"
                    value={externalApiKey}
                    onChange={(e) => setExternalApiKey(e.target.value)}
                    onBlur={() => saveSetting('ai.externalApiKey', externalApiKey)}
                  />
                  <Input
                    name="externalChatModel"
                    label="Chat Model"
                    helpText="Model identifier to use for chat, e.g. anthropic/claude-3-haiku or gpt-4o-mini."
                    placeholder="anthropic/claude-3-haiku"
                    value={externalChatModel}
                    onChange={(e) => setExternalChatModel(e.target.value)}
                    onBlur={() => saveSetting('ai.externalChatModel', externalChatModel)}
                  />

                  <div className="pt-4 border-t border-border-subtle">
                    <label className="block text-base/6 font-medium text-text-primary">Embedding Provider</label>
                    <p className="mt-1 text-sm text-text-muted">Choose how document embeddings are generated for the knowledge base (RAG).</p>
                    <select
                      value={embeddingProvider}
                      onChange={(e) => {
                        setEmbeddingProvider(e.target.value)
                        saveSetting('ai.embeddingProvider', e.target.value)
                      }}
                      className="mt-2 block w-full rounded-md bg-surface-primary px-3 py-2 text-base text-text-primary border border-border-default focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-primary sm:text-sm/6"
                    >
                      <option value="ollama">Local (Ollama — nomic-embed-text)</option>
                      <option value="openai_compatible">External API (OpenAI-compatible)</option>
                    </select>
                  </div>

                  {embeddingProvider === 'openai_compatible' && (
                    <>
                      <Alert
                        type="warning"
                        variant="bordered"
                        title="Changing the embedding provider requires re-indexing"
                        message="If you have previously indexed documents using a different provider, you will need to delete and re-upload them so they are re-indexed with the new embedding model."
                        className="!mt-2"
                      />
                      <Input
                        name="externalEmbeddingApiBaseUrl"
                        label="Embedding API Base URL"
                        helpText="Leave empty to reuse the Chat API Base URL above."
                        placeholder="https://api.openai.com/v1"
                        value={externalEmbeddingApiBaseUrl}
                        onChange={(e) => setExternalEmbeddingApiBaseUrl(e.target.value)}
                        onBlur={() => saveSetting('ai.externalEmbeddingApiBaseUrl', externalEmbeddingApiBaseUrl)}
                      />
                      <Input
                        name="externalEmbeddingApiKey"
                        label="Embedding API Key"
                        helpText="Leave empty to reuse the Chat API Key above."
                        placeholder="sk-..."
                        type="password"
                        value={externalEmbeddingApiKey}
                        onChange={(e) => setExternalEmbeddingApiKey(e.target.value)}
                        onBlur={() => saveSetting('ai.externalEmbeddingApiKey', externalEmbeddingApiKey)}
                      />
                      <Input
                        name="externalEmbeddingModel"
                        label="Embedding Model"
                        helpText="Model to use for embeddings, e.g. text-embedding-3-small."
                        placeholder="text-embedding-3-small"
                        value={externalEmbeddingModel}
                        onChange={(e) => setExternalEmbeddingModel(e.target.value)}
                        onBlur={() => saveSetting('ai.externalEmbeddingModel', externalEmbeddingModel)}
                      />
                      <Input
                        name="externalEmbeddingDimension"
                        label="Embedding Dimension"
                        helpText="Vector size produced by the model. text-embedding-3-small → 1536, text-embedding-ada-002 → 1536, text-embedding-3-large → 3072."
                        placeholder="1536"
                        type="number"
                        value={externalEmbeddingDimension}
                        onChange={(e) => setExternalEmbeddingDimension(e.target.value)}
                        onBlur={() => saveSetting('ai.externalEmbeddingDimension', externalEmbeddingDimension)}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <StyledSectionHeader title="Settings" className="mt-8 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
            <div className="space-y-4">
              <Switch
                checked={chatSuggestionsEnabled}
                onChange={(newVal) => {
                  setChatSuggestionsEnabled(newVal)
                  updateSettingMutation.mutate({ key: 'chat.suggestionsEnabled', value: newVal })
                }}
                label="Chat Suggestions"
                description="Display AI-generated conversation starters in the chat interface"
              />
              <Input
                name="aiAssistantCustomName"
                label="Assistant Name"
                helpText='Give your AI assistant a custom name that will be used in the chat interface and other areas of the application.'
                placeholder="AI Assistant"
                value={aiAssistantCustomName}
                onChange={(e) => setAiAssistantCustomName(e.target.value)}
                onBlur={() =>
                  updateSettingMutation.mutate({
                    key: 'ai.assistantCustomName',
                    value: aiAssistantCustomName,
                  })
                }
              />
            </div>
          </div>

          {!isExternalProvider && <ActiveModelDownloads withHeader />}

          {isExternalProvider ? (
            <>
              <StyledSectionHeader title="Models" className="mt-12 mb-4" />
              <Alert
                type="info"
                variant="solid"
                title="Model management is handled by your external provider"
                message={`Model downloads and deletions are not available when using an external API. Set the chat model above and your provider will handle the rest.`}
                className="!mt-2"
              />
            </>
          ) : (
            <>
              <StyledSectionHeader title="Models" className="mt-12 mb-4" />
              <div className="flex justify-start items-center gap-3 mt-4">
                <Input
                  name="search"
                  label=""
                  placeholder="Search language models.."
                  value={queryUI}
                  onChange={(e) => {
                    setQueryUI(e.target.value)
                    debouncedSetQuery(e.target.value)
                  }}
                  className="w-1/3"
                  leftIcon={<IconSearch className="w-5 h-5 text-text-muted" />}
                />
                <StyledButton
                  variant="secondary"
                  onClick={handleForceRefresh}
                  icon="IconRefresh"
                  loading={isForceRefreshing}
                  className='mt-1'
                >
                  Refresh Models
                </StyledButton>
              </div>
              <StyledTable<NomadOllamaModel>
                className="font-semibold mt-4"
                rowLines={true}
                columns={[
                  {
                    accessor: 'name',
                    title: 'Name',
                    render(record) {
                      return (
                        <div className="flex flex-col">
                          <p className="text-lg font-semibold">{record.name}</p>
                          <p className="text-sm text-text-muted">{record.description}</p>
                        </div>
                      )
                    },
                  },
                  {
                    accessor: 'estimated_pulls',
                    title: 'Estimated Pulls',
                  },
                  {
                    accessor: 'model_last_updated',
                    title: 'Last Updated',
                  },
                ]}
                data={availableModelData?.models || []}
                loading={isFetching}
                expandable={{
                  expandedRowRender: (record) => (
                    <div className="pl-14">
                      <div className="bg-surface-primary overflow-hidden">
                        <table className="min-w-full divide-y divide-border-subtle">
                          <thead className="bg-surface-primary">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                                Tag
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                                Input Type
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                                Context Size
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                                Model Size
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-surface-primary divide-y divide-border-subtle">
                            {record.tags.map((tag, tagIndex) => {
                              const isInstalled = props.models.installedModels.some(
                                (mod) => mod.name === tag.name
                              )
                              return (
                                <tr key={tagIndex} className="hover:bg-surface-secondary">
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm font-medium text-text-primary">
                                      {tag.name}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm text-text-secondary">{tag.input || 'N/A'}</span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm text-text-secondary">
                                      {tag.context || 'N/A'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm text-text-secondary">{tag.size || 'N/A'}</span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <StyledButton
                                      variant={isInstalled ? 'danger' : 'primary'}
                                      onClick={() => {
                                        if (!isInstalled) {
                                          handleInstallModel(tag.name)
                                        } else {
                                          confirmDeleteModel(tag.name)
                                        }
                                      }}
                                      icon={isInstalled ? 'IconTrash' : 'IconDownload'}
                                    >
                                      {isInstalled ? 'Delete' : 'Install'}
                                    </StyledButton>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ),
                }}
              />
              <div className="flex justify-center mt-6">
                {availableModelData?.hasMore && (
                  <StyledButton
                    variant="primary"
                    onClick={() => {
                      setLimit((prev) => prev + 15)
                    }}
                  >
                    Load More
                  </StyledButton>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </SettingsLayout>
  )
}
