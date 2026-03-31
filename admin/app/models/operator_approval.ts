import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OperatorTask from './operator_task.js'
import OperatorTaskStep from './operator_task_step.js'

export type OperatorApprovalActionType =
  | 'destructive'
  | 'container_removal'
  | 'config_change'
  | 'network_action'
  | 'file_write'
  | 'shell_exec'

export type OperatorApprovalStatus = 'pending' | 'approved' | 'denied'

export default class OperatorApproval extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare task_id: number

  @column()
  declare step_id: number | null

  @column()
  declare action_type: OperatorApprovalActionType

  @column()
  declare action_description: string

  @column()
  declare action_payload: Record<string, unknown> | null

  @column()
  declare status: OperatorApprovalStatus

  @column.dateTime()
  declare resolved_at: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @belongsTo(() => OperatorTask, { foreignKey: 'task_id' })
  declare task: BelongsTo<typeof OperatorTask>

  @belongsTo(() => OperatorTaskStep, { foreignKey: 'step_id' })
  declare step: BelongsTo<typeof OperatorTaskStep>
}
