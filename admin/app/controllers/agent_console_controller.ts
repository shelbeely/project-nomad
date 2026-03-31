import { LlmService } from '#services/llm_service'
import { SystemService } from '#services/system_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { NOMAD_MCP_TOOLS } from '../mcp/tools.js'

@inject()
export default class AgentConsoleController {
  constructor(
    private systemService: SystemService,
    private llmService: LlmService
  ) {}

  async index({ inertia }: HttpContext) {
    const [services, internet] = await Promise.all([
      this.systemService.getServices({ installedOnly: false }),
      this.systemService.getInternetStatus(),
    ])
    return inertia.render('agent/index', {
      agent: {
        provider: this.llmService.provider,
        internet,
        services,
      },
    })
  }

  async run({ inertia }: HttpContext) {
    const models = await this.llmService.getInstalledModels()
    return inertia.render('agent/run', {
      agent: {
        provider: this.llmService.provider,
        models: models ?? [],
        tools: NOMAD_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      },
    })
  }

  async tools({ inertia }: HttpContext) {
    return inertia.render('agent/tools', {
      agent: {
        provider: this.llmService.provider,
        tools: NOMAD_MCP_TOOLS,
      },
    })
  }
}
