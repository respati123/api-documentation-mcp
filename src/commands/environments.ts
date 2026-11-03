import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineCommand } from '../registry.js'
import { hashRaw, readWorkspace, secretFingerprint, updateWorkspace } from '../store.js'
import { variableNameSchema, variableValueSchema } from '../schemas.js'
import type { StoredWorkspace, WorkspaceEnvironment, WorkspaceVariable, WorkspaceVariables } from '../types.js'

const workspaceId = z.string().min(1).describe('Workspace id from workspace.list')
const environmentId = z.string().min(1).describe('Environment id from environment.list')
const confirm = z.literal(true).describe('Must be true; ask the user first')
const maxEnvironments = 100

function variablesOf(workspace: StoredWorkspace): WorkspaceVariables {
  return workspace.variables ?? { globals: [], environments: [] }
}

function withVariables(workspace: StoredWorkspace, variables: WorkspaceVariables): StoredWorkspace {
  return { ...workspace, variables }
}

// Secret values are never returned. Only their names and that they are secret.
function masked(row: WorkspaceVariable) {
  return { id: row.id, name: row.name, secret: row.secret, value: row.secret ? '<secret>' : row.value }
}

function findEnvironment(variables: WorkspaceVariables, id: string): WorkspaceEnvironment {
  const environment = variables.environments.find((item) => item.id === id)
  if (!environment) throw new Error(`Environment "${id}" was not found.`)
  return environment
}

const scopeSchema = z.enum(['global', 'environment']).describe('global for workspace-wide values, environment for one environment')

// The variables a scope holds. An environment scope needs its id.
function rowsFor(variables: WorkspaceVariables, scope: 'global' | 'environment', env: string | undefined): WorkspaceVariable[] {
  if (scope === 'global') return variables.globals
  if (!env) throw new Error('environmentId is required for an environment variable.')
  return findEnvironment(variables, env).variables
}

// Identifies a variable's current state. A write passes the revision it was based on, so a change made since then is refused.
// A secret's value is never read here. Its encrypted form is fingerprinted instead, so a secret the app sets again still counts as a change.
function variableRevision(workspaceId: string, row: WorkspaceVariable | undefined): string | null {
  if (!row) return null
  const sealed = row.secret ? secretFingerprint(workspaceId, row.id) : ''
  return hashRaw(JSON.stringify({ id: row.id, name: row.name, secret: row.secret, value: row.secret ? '' : row.value, sealed }))
}

function changedSinceRead(name: string): Error {
  return new Error(`"${name}" changed since you read it. Read it again with variable.get and review the change before writing.`)
}

export const environmentCommands = [
  defineCommand({
    id: 'environment.list',
    group: 'environment',
    title: 'List environments and variables',
    description: 'List globals and environments with their variables. Secret values are shown as <secret>.',
    params: z.object({ workspaceId }),
    readOnly: true,
    run: ({ workspaceId: id }) => {
      const { workspace } = readWorkspace(id)
      const variables = variablesOf(workspace)
      return {
        activeEnvironmentId: workspace.activeEnvironmentId ?? null,
        globals: variables.globals.map(masked),
        environments: variables.environments.map((environment) => ({
          id: environment.id,
          name: environment.name,
          variables: environment.variables.map(masked),
        })),
      }
    },
  }),
  defineCommand({
    id: 'environment.create',
    group: 'environment',
    title: 'Create environment',
    description: 'Create an empty environment. It is not activated until environment.activate.',
    params: z.object({ workspaceId, name: z.string().trim().min(1).max(160) }),
    readOnly: false,
    run: ({ workspaceId: id, name }) => {
      let created: WorkspaceEnvironment | undefined
      updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        if (variables.environments.length >= maxEnvironments) throw new Error(`A workspace can have at most ${maxEnvironments} environments.`)
        created = { id: randomUUID(), name, variables: [] }
        return withVariables(workspace, { ...variables, environments: [...variables.environments, created] })
      })
      return { id: created?.id, name }
    },
  }),
  defineCommand({
    id: 'environment.rename',
    group: 'environment',
    title: 'Rename environment',
    description: 'Rename an environment.',
    params: z.object({ workspaceId, environmentId, name: z.string().trim().min(1).max(160) }),
    readOnly: false,
    run: ({ workspaceId: id, environmentId: env, name }) => {
      updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        findEnvironment(variables, env)
        return withVariables(workspace, {
          ...variables,
          environments: variables.environments.map((item) => (item.id === env ? { ...item, name } : item)),
        })
      })
      return { id: env, name }
    },
  }),
  defineCommand({
    id: 'environment.duplicate',
    group: 'environment',
    title: 'Duplicate environment',
    description: 'Copy an environment as "<name>_copy" with new variable ids. Secret values are copied as empty and must be set in the app.',
    params: z.object({ workspaceId, environmentId }),
    readOnly: false,
    run: ({ workspaceId: id, environmentId: env }) => {
      let copy: WorkspaceEnvironment | undefined
      updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        const source = findEnvironment(variables, env)
        if (variables.environments.length >= maxEnvironments) throw new Error(`A workspace can have at most ${maxEnvironments} environments.`)
        copy = {
          id: randomUUID(),
          name: `${source.name}_copy`,
          variables: source.variables.map((row) => ({ ...row, id: randomUUID(), value: row.secret ? '' : row.value })),
        }
        return withVariables(workspace, { ...variables, environments: [...variables.environments, copy] })
      })
      return { id: copy?.id, name: copy?.name }
    },
  }),
  defineCommand({
    id: 'environment.delete',
    group: 'environment',
    title: 'Delete environment',
    description: 'Delete an environment and its variables. Requires confirm=true after the user confirms.',
    params: z.object({ workspaceId, environmentId, confirm }),
    readOnly: false,
    destructive: true,
    run: ({ workspaceId: id, environmentId: env }) => {
      updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        findEnvironment(variables, env)
        return {
          ...withVariables(workspace, { ...variables, environments: variables.environments.filter((item) => item.id !== env) }),
          activeEnvironmentId: workspace.activeEnvironmentId === env ? null : workspace.activeEnvironmentId,
        }
      })
      return { deleted: true, environmentId: env }
    },
  }),
  defineCommand({
    id: 'environment.activate',
    group: 'environment',
    title: 'Set active environment',
    description: 'Make an environment the active one that requests use, or pass null to use none.',
    params: z.object({ workspaceId, environmentId: z.string().min(1).nullable() }),
    readOnly: false,
    run: ({ workspaceId: id, environmentId: env }) => {
      updateWorkspace(id, (workspace) => {
        if (env !== null) findEnvironment(variablesOf(workspace), env)
        return { ...workspace, activeEnvironmentId: env }
      })
      return { activeEnvironmentId: env }
    },
  }),
  defineCommand({
    id: 'variable.get',
    group: 'environment',
    title: 'Get variable',
    description:
      'Read one variable and its revision. Secret values are never returned. Pass the revision to variable.set or variable.delete, so a change made since this read is refused.',
    params: z.object({
      workspaceId,
      scope: scopeSchema,
      environmentId: z.string().min(1).optional().describe('Required when scope is environment'),
      name: variableNameSchema,
    }),
    readOnly: true,
    run: ({ workspaceId: id, scope, environmentId: env, name }) => {
      const { workspace } = readWorkspace(id)
      const existing = rowsFor(variablesOf(workspace), scope, env).find((row) => row.name === name)
      if (!existing) return { exists: false, name, scope, environmentId: env ?? null, revision: null }
      return { exists: true, ...masked(existing), scope, environmentId: env ?? null, revision: variableRevision(id, existing) }
    },
  }),
  defineCommand({
    id: 'variable.set',
    group: 'environment',
    title: 'Set variable',
    description:
      'Create or update a variable in globals or one environment. Read the variable with variable.get first and pass its revision as expectedRevision (null when it does not exist yet). A secret variable is created with an empty value; its value must be entered in the desktop app, and an existing secret cannot be changed here.',
    params: z.object({
      workspaceId,
      scope: scopeSchema,
      environmentId: z.string().min(1).optional().describe('Required when scope is environment'),
      name: variableNameSchema,
      value: variableValueSchema.optional(),
      secret: z.boolean().optional().describe('Secret variables keep their value in the app only'),
      expectedRevision: z.string().min(1).nullable().optional().describe('Revision from variable.get; null when the variable does not exist yet'),
    }),
    readOnly: false,
    run: ({ workspaceId: id, scope, environmentId: env, name, value, secret, expectedRevision }) => {
      const updated = updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        if (scope === 'environment' && !env) throw new Error('environmentId is required for an environment variable.')
        const rows = rowsFor(variables, scope, env)
        const existing = rows.find((row) => row.name === name)
        if (expectedRevision !== undefined) {
          if (existing && expectedRevision === null) throw new Error(`"${name}" already exists. Read it with variable.get and pass its revision.`)
          if (variableRevision(id, existing) !== expectedRevision) throw changedSinceRead(name)
        }
        if (existing?.secret && value !== undefined && value !== '') {
          throw new Error(`"${name}" is a secret. Change its value in the desktop app.`)
        }
        if (secret === true && value) throw new Error(`"${name}" is a secret. Enter its value in the desktop app.`)
        const row: WorkspaceVariable = {
          id: existing?.id ?? randomUUID(),
          name,
          value: secret ? '' : (value ?? existing?.value ?? ''),
          secret: secret ?? existing?.secret ?? false,
        }
        const nextRows = existing ? rows.map((item) => (item.id === existing.id ? row : item)) : [...rows, row]
        if (scope === 'global') return withVariables(workspace, { ...variables, globals: nextRows })
        return withVariables(workspace, {
          ...variables,
          environments: variables.environments.map((item) => (item.id === env ? { ...item, variables: nextRows } : item)),
        })
      })
      const written = rowsFor(variablesOf(updated), scope, env).find((row) => row.name === name)
      return { name, scope, environmentId: env ?? null, secret: secret ?? null, revision: variableRevision(id, written) }
    },
  }),
  defineCommand({
    id: 'variable.delete',
    group: 'environment',
    title: 'Delete variable',
    description:
      'Delete a variable from globals or one environment. Read it with variable.get first and pass its revision as expectedRevision. Requires confirm=true after the user confirms.',
    params: z.object({
      workspaceId,
      scope: scopeSchema,
      environmentId: z.string().min(1).optional(),
      name: variableNameSchema,
      expectedRevision: z.string().min(1).nullable().optional().describe('Revision from variable.get'),
      confirm,
    }),
    readOnly: false,
    destructive: true,
    run: ({ workspaceId: id, scope, environmentId: env, name, expectedRevision }) => {
      updateWorkspace(id, (workspace) => {
        const variables = variablesOf(workspace)
        if (expectedRevision !== undefined) {
          const existing = rowsFor(variables, scope, env).find((row) => row.name === name)
          if (variableRevision(id, existing) !== expectedRevision) throw changedSinceRead(name)
        }
        if (scope === 'global') {
          return withVariables(workspace, { ...variables, globals: variables.globals.filter((row) => row.name !== name) })
        }
        if (!env) throw new Error('environmentId is required for an environment variable.')
        return withVariables(workspace, {
          ...variables,
          environments: variables.environments.map((item) =>
            item.id === env ? { ...item, variables: item.variables.filter((row) => row.name !== name) } : item,
          ),
        })
      })
      return { deleted: true, name, scope }
    },
  }),
]
