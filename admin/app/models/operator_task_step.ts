import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OperatorTask from './operator_task.js'

export type OperatorTaskStepStatus = 'pending' | 'running' | 'done' | 'failed'

export default class OperatorTaskStep extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare task_id: number

  @column()
  declare step_number: number

  @column()
  declare status: OperatorTaskStepStatus

  @column()
  declare tool_name: string | null

  @column()
  declare tool_args: Record<string, unknown> | null

  @column()
  declare tool_result: unknown | null

  @column()
  declare thinking: string | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @belongsTo(() => OperatorTask, { foreignKey: 'task_id' })
  declare task: BelongsTo<typeof OperatorTask>
}
