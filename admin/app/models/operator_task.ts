import { DateTime } from 'luxon'
import { BaseModel, column, hasMany, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import OperatorTaskStep from './operator_task_step.js'
import OperatorArtifact from './operator_artifact.js'
import OperatorApproval from './operator_approval.js'

export type OperatorTaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'blocked'
export type OperatorTaskFinishReason = 'stop' | 'max_iterations' | 'error' | 'blocked'

export default class OperatorTask extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare goal: string

  @column()
  declare status: OperatorTaskStatus

  @column()
  declare model: string | null

  @column()
  declare provider: string

  @column()
  declare max_iterations: number

  @column()
  declare response: string | null

  @column()
  declare error: string | null

  @column()
  declare finish_reason: OperatorTaskFinishReason | null

  @column.dateTime()
  declare completed_at: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @hasMany(() => OperatorTaskStep, { foreignKey: 'task_id' })
  declare steps: HasMany<typeof OperatorTaskStep>

  @hasMany(() => OperatorArtifact, { foreignKey: 'task_id' })
  declare artifacts: HasMany<typeof OperatorArtifact>

  @hasMany(() => OperatorApproval, { foreignKey: 'task_id' })
  declare approvals: HasMany<typeof OperatorApproval>
}
