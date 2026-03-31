import { IaMirrorService } from '#services/ia_mirror_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class IaMirrorController {
  constructor(private iaMirrorService: IaMirrorService) {}

  async search({ request, response }: HttpContext) {
    const q = request.qs().q as string | undefined
    if (!q?.trim()) {
      return response.status(400).json({ error: 'Missing required query parameter: q' })
    }

    const rows = Math.min(parseInt(request.qs().rows ?? '10', 10) || 10, 50)
    const mediaType = request.qs().mediatype as string | undefined

    const result = await this.iaMirrorService.search(q.trim(), rows, mediaType)
    return response.json(result)
  }

  async item({ params, response }: HttpContext) {
    const identifier = params.identifier as string
    if (!identifier) {
      return response.status(400).json({ error: 'Missing identifier' })
    }
    const item = await this.iaMirrorService.getItem(identifier)
    return response.json(item)
  }
}
