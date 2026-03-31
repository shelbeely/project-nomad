import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * Optional API key middleware for agent / remote access routes.
 *
 * Activated only when NOMAD_API_KEY is set in the environment.
 * When active, each request must supply the key as either:
 *   X-NOMAD-Key: <key>
 *   Authorization: Bearer <key>
 *
 * When NOMAD_API_KEY is not set (default), all requests pass through
 * so that unauthenticated local-network deployments work out of the box.
 */
export default class ApiKeyMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    const configuredKey = env.get('NOMAD_API_KEY')

    // No key configured — allow all requests
    if (!configuredKey) {
      return next()
    }

    const headerKey =
      request.header('X-NOMAD-Key') ??
      request.header('Authorization')?.replace(/^Bearer\s+/i, '')

    if (!headerKey || headerKey !== configuredKey) {
      return response.status(401).json({
        error: 'Unauthorized',
        message: 'This NOMAD instance requires an API key. Supply it via X-NOMAD-Key or Authorization: Bearer <key>.',
      })
    }

    return next()
  }
}
