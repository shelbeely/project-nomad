import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * AI Operator UI — core tables.
 *
 * operator_tasks       — one row per user goal / agent run
 * operator_task_steps  — one row per tool-call iteration within a task
 * operator_artifacts   — notes / summaries / reports produced during a task
 * operator_approvals   — safety gate: destructive actions that need human sign-off
 */
export default class extends BaseSchema {
  async up() {
    // ── Tasks ────────────────────────────────────────────────────────────────
    await this.schema.createTable('operator_tasks', (table) => {
      table.increments('id')
      table.string('title', 255).notNullable().defaultTo('Untitled task')
      table.text('goal').notNullable()
      table
        .enum('status', ['pending', 'running', 'complete', 'failed', 'blocked'])
        .notNullable()
        .defaultTo('pending')
      table.string('model', 255).nullable()
      table.string('provider', 64).notNullable().defaultTo('ollama')
      table.integer('max_iterations').notNullable().defaultTo(10)
      table.text('response').nullable()
      table.text('error').nullable()
      table
        .enum('finish_reason', ['stop', 'max_iterations', 'error', 'blocked'])
        .nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    // ── Task steps (tool-call trace) ─────────────────────────────────────────
    await this.schema.createTable('operator_task_steps', (table) => {
      table.increments('id')
      table.integer('task_id').unsigned().notNullable().references('id').inTable('operator_tasks').onDelete('CASCADE')
      table.integer('step_number').notNullable()
      table
        .enum('status', ['pending', 'running', 'done', 'failed'])
        .notNullable()
        .defaultTo('pending')
      table.string('tool_name', 128).nullable()
      table.json('tool_args').nullable()
      table.json('tool_result').nullable()
      table.text('thinking').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    // ── Artifacts ─────────────────────────────────────────────────────────────
    await this.schema.createTable('operator_artifacts', (table) => {
      table.increments('id')
      table.integer('task_id').unsigned().notNullable().references('id').inTable('operator_tasks').onDelete('CASCADE')
      table.enum('type', ['note', 'summary', 'report', 'file']).notNullable().defaultTo('note')
      table.string('title', 255).notNullable()
      table.text('content').notNullable()
      table.json('metadata').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    // ── Approvals (safety gate) ───────────────────────────────────────────────
    await this.schema.createTable('operator_approvals', (table) => {
      table.increments('id')
      table.integer('task_id').unsigned().notNullable().references('id').inTable('operator_tasks').onDelete('CASCADE')
      table.integer('step_id').unsigned().nullable().references('id').inTable('operator_task_steps').onDelete('SET NULL')
      table
        .enum('action_type', ['destructive', 'container_removal', 'config_change', 'network_action', 'file_write', 'shell_exec'])
        .notNullable()
      table.text('action_description').notNullable()
      table.json('action_payload').nullable()
      table
        .enum('status', ['pending', 'approved', 'denied'])
        .notNullable()
        .defaultTo('pending')
      table.timestamp('resolved_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    await this.schema.dropTableIfExists('operator_approvals')
    await this.schema.dropTableIfExists('operator_artifacts')
    await this.schema.dropTableIfExists('operator_task_steps')
    await this.schema.dropTableIfExists('operator_tasks')
  }
}
