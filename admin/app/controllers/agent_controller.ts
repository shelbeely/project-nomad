import { DockerService } from '#services/docker_service'
import { LlmService } from '#services/llm_service'
import { OllamaService } from '#services/ollama_service'
import { SystemService } from '#services/system_service'
import { ZimService } from '#services/zim_service'
import { DownloadService } from '#services/download_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class AgentController {
  constructor(
    private systemService: SystemService,
    private dockerService: DockerService,
    private ollamaService: OllamaService,
    private llmService: LlmService,
    private zimService: ZimService,
    private downloadService: DownloadService
  ) {}

  /**
   * GET /api/agent/status
   *
   * Returns a single machine-readable snapshot of the entire NOMAD system:
   * services, internet status, AI provider, active downloads, and storage.
   * Designed to be polled by an AI agent to understand the current state
   * before deciding what actions to take.
   */
  async status({ response }: HttpContext) {
    const [services, internet, downloads, models, systemInfo] = await Promise.allSettled([
      this.systemService.getServices({ installedOnly: false }),
      this.systemService.getInternetStatus(),
      this.downloadService.listDownloadJobs(),
      this.llmService.getInstalledModels(),
      this.systemService.getSystemInfo(),
    ])

    return response.json({
      status: 'ok',
      provider: this.llmService.provider,
      internet: internet.status === 'fulfilled' ? internet.value : null,
      services:
        services.status === 'fulfilled'
          ? services.value.map((s) => ({
              service_name: s.service_name,
              friendly_name: s.friendly_name,
              installed: s.installed,
              installation_status: s.installation_status,
              ui_location: s.ui_location,
            }))
          : [],
      models: models.status === 'fulfilled' ? (models.value ?? []).map((m) => m.name) : [],
      downloads:
        downloads.status === 'fulfilled'
          ? {
              active: downloads.value.filter((j) => j.status === 'active').length,
              jobs: downloads.value,
            }
          : { active: 0, jobs: [] },
      disk:
        systemInfo.status === 'fulfilled'
          ? { disk: systemInfo.value?.disk ?? null, fsSize: systemInfo.value?.fsSize ?? null }
          : null,
    })
  }

  /**
   * POST /api/agent/setup
   *
   * Headless setup endpoint — allows an AI agent to install services,
   * select a Wikipedia tier, and queue model downloads without using the UI.
   *
   * Request body (all fields optional except you need at least one):
   * {
   *   services:          string[]  // service_names to install
   *   wikipedia_tier_id: string    // optionId from GET /api/zim/wikipedia
   *   ollama_models:     string[]  // model names to download via Ollama
   * }
   *
   * Returns a summary of what was dispatched.
   */
  async setup({ request, response }: HttpContext) {
    const body = request.body() as {
      services?: string[]
      wikipedia_tier_id?: string
      ollama_models?: string[]
    }

    const results: {
      services: { name: string; success: boolean; message: string }[]
      wikipedia: { success: boolean; message: string } | null
      models: { name: string; success: boolean; message: string }[]
      errors: string[]
    } = {
      services: [],
      wikipedia: null,
      models: [],
      errors: [],
    }

    // 1. Install requested services
    if (Array.isArray(body.services) && body.services.length > 0) {
      for (const serviceName of body.services) {
        try {
          const result = await this.dockerService.createContainerPreflight(serviceName)
          results.services.push({ name: serviceName, success: result.success, message: result.message })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          results.services.push({ name: serviceName, success: false, message: msg })
          results.errors.push(`Failed to install ${serviceName}: ${msg}`)
        }
      }
    }

    // 2. Select Wikipedia tier (records preference; actual download is handled by ZimService)
    if (typeof body.wikipedia_tier_id === 'string' && body.wikipedia_tier_id) {
      try {
        await this.zimService.selectWikipedia(body.wikipedia_tier_id)
        results.wikipedia = { success: true, message: `Wikipedia tier "${body.wikipedia_tier_id}" selected.` }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        results.wikipedia = { success: false, message: msg }
        results.errors.push(`Wikipedia selection failed: ${msg}`)
      }
    }

    // 3. Download Ollama models
    if (Array.isArray(body.ollama_models) && body.ollama_models.length > 0) {
      if (!this.llmService.isOllamaProvider()) {
        logger.warn('[AgentController] ollama_models requested but provider is not Ollama — skipping model downloads')
        results.errors.push('ollama_models were requested but AI_PROVIDER is not "ollama". Model downloads skipped.')
      } else {
        for (const modelName of body.ollama_models) {
          try {
            const result = await this.ollamaService.dispatchModelDownload(modelName)
            results.models.push({ name: modelName, success: result.success, message: result.message })
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            results.models.push({ name: modelName, success: false, message: msg })
            results.errors.push(`Model download failed for ${modelName}: ${msg}`)
          }
        }
      }
    }

    const hasErrors = results.errors.length > 0
    return response.status(hasErrors ? 207 : 200).json({
      success: !hasErrors,
      results,
      hint: 'Poll GET /api/downloads/jobs to track download progress.',
    })
  }
}
