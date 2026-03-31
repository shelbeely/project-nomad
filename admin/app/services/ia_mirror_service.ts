import { DockerService } from './docker_service.js'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import axios from 'axios'
import { SERVICE_NAMES } from '../../constants/service_names.js'

export interface IaItem {
  identifier: string
  title: string
  description: string
  mediatype: string
  creator?: string
  date?: string
  subject?: string | string[]
  downloads?: number
}

export interface IaSearchResult {
  items: IaItem[]
  total: number
  query: string
}

/**
 * Internet Archive mirror service.
 *
 * Proxies requests to the locally running dweb-mirror container
 * (nomad_ia_mirror, port 4244). When the container is not running,
 * falls back gracefully with a descriptive error.
 *
 * The dweb-mirror project (https://github.com/internetarchive/dweb-mirror)
 * provides an offline cache of Internet Archive content — 38M+ books,
 * historical documents, audio, video, and software.
 */
@inject()
export class IaMirrorService {
  constructor(private dockerService: DockerService) {}

  private async _baseUrl(): Promise<string> {
    const url = await this.dockerService.getServiceURL(SERVICE_NAMES.IA_MIRROR)
    if (!url) throw new Error('Internet Archive mirror is not installed or running. Install it via the nomad_install_service MCP tool with service_name "nomad_ia_mirror", or POST /api/agent/setup with {"services":["nomad_ia_mirror"]}.')
    return url
  }

  /**
   * Search the Internet Archive mirror.
   *
   * Falls back to the live Archive.org search API when the local mirror is
   * not available, so agents get useful results even before content is cached.
   */
  async search(query: string, rows = 10, mediaType?: string): Promise<IaSearchResult> {
    // Try local mirror first
    try {
      const base = await this._baseUrl()
      const params: Record<string, string | number> = { query: query.trim(), rows }
      if (mediaType) params.mediatype = mediaType

      const res = await axios.get(`${base}/api/search`, {
        params,
        timeout: 8000,
      })

      if (res.data?.items) {
        return { items: res.data.items, total: res.data.total ?? res.data.items.length, query }
      }
    } catch (localErr) {
      logger.warn(`[IaMirrorService] Local mirror unavailable — falling back to Archive.org: ${localErr instanceof Error ? localErr.message : localErr}`)
    }

    // Fallback: live Archive.org search (requires internet)
    return this._searchLive(query, rows, mediaType)
  }

  /**
   * Get metadata and file list for a specific Archive item by identifier.
   */
  async getItem(identifier: string): Promise<{ metadata: Record<string, unknown>; files: unknown[] }> {
    // Try local mirror first
    try {
      const base = await this._baseUrl()
      const res = await axios.get(`${base}/metadata/${identifier}`, { timeout: 8000 })
      if (res.data) return res.data
    } catch {
      // fall through to live
    }

    // Fallback: live Archive.org metadata API
    try {
      const res = await axios.get(`https://archive.org/metadata/${identifier}`, { timeout: 10000 })
      return res.data
    } catch (err) {
      throw new Error(`Could not retrieve item "${identifier}" from local mirror or Archive.org: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── Live Archive.org fallback ──────────────────────────────────────────────

  private async _searchLive(query: string, rows: number, mediaType?: string): Promise<IaSearchResult> {
    const params: Record<string, string | number | boolean> = {
      q: query.trim(),
      rows: Math.min(rows, 50),
      output: 'json',
      fl: 'identifier,title,description,mediatype,creator,date,subject,downloads',
      'sort[]': 'downloads desc',
    }
    if (mediaType) params.q = `${params.q} AND mediatype:${mediaType}`

    const res = await axios.get('https://archive.org/advancedsearch.php', {
      params,
      timeout: 10000,
    })

    const docs: Record<string, unknown>[] = res.data?.response?.docs ?? []
    const items: IaItem[] = docs.map((d) => ({
      identifier: String(d.identifier ?? ''),
      title: String(d.title ?? ''),
      description: String(d.description ?? ''),
      mediatype: String(d.mediatype ?? ''),
      creator: d.creator !== undefined ? String(d.creator) : undefined,
      date: d.date !== undefined ? String(d.date) : undefined,
      subject: d.subject as string | string[] | undefined,
      downloads: typeof d.downloads === 'number' ? d.downloads : undefined,
    }))

    return { items, total: res.data?.response?.numFound ?? items.length, query }
  }
}
