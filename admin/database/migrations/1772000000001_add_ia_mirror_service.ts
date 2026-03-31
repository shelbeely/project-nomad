import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Add the Internet Archive mirror (dweb-mirror) as an installable NOMAD service.
 *
 * dweb-mirror (https://github.com/internetarchive/dweb-mirror) provides an
 * offline-cacheable mirror of the Internet Archive — 38M+ books, historical
 * documents, audio, video, and software — served via a local HTTP API on port 4244.
 */
export default class extends BaseSchema {
  protected tableName = 'services'

  async up() {
    this.defer(async (db) => {
      const existing = await db.from(this.tableName).where('service_name', 'nomad_ia_mirror').first()
      if (existing) return

      const storagePath = process.env.NOMAD_STORAGE_PATH ?? '/opt/project-nomad/storage'

      await db.from(this.tableName).insert({
        service_name: 'nomad_ia_mirror',
        friendly_name: 'Internet Archive Mirror',
        powered_by: 'Internet Archive / dweb-mirror',
        display_order: 12,
        description:
          '38M+ books, historical documents, audio, video, and software from the Internet Archive — cacheable offline',
        icon: 'IconWorldDownload',
        container_image: 'internetarchive/dweb-mirror:latest',
        source_repo: 'https://github.com/internetarchive/dweb-mirror',
        container_command: null,
        container_config: JSON.stringify({
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            PortBindings: { '4244/tcp': [{ HostPort: '8500' }] },
            Binds: [`${storagePath}/ia-mirror:/usr/local/dweb-mirror/.data`],
          },
          ExposedPorts: { '4244/tcp': {} },
        }),
        ui_location: '8500',
        installed: false,
        installation_status: 'idle',
        is_dependency_service: false,
        depends_on: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from(this.tableName).where('service_name', 'nomad_ia_mirror').delete()
    })
  }
}
