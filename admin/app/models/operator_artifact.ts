import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OperatorTask from './operator_task.js'

export type OperatorArtifactType = 'note' | 'summary' | 'report' | 'file'

export default class OperatorArtifact extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare task_id: number

  @column()
  declare type: OperatorArtifactType

  @column()
  declare title: string

  @column()
  declare content: string

  @column()
  declare metadata: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @belongsTo(() => OperatorTask, { foreignKey: 'task_id' })
  declare task: BelongsTo<typeof OperatorTask>
}
