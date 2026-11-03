import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineCommand } from '../registry.js'
import { deleteWorkspace, insertWorkspace, listWorkspaces, readWorkspace, updateWorkspace } from '../store.js'
import { safeTree } from '../redact.js'
import type { StoredWorkspace } from '../types.js'

const workspaceId = z.string().min(1).describe('Workspace id from workspace.list')
const emptyVariables = () => ({ globals: [], environments: [] })

export const workspaceCommands = [
  defineCommand({
    id: 'workspace.list',
    group: 'workspace',
    title: 'List workspaces',
    description: 'List the workspaces in the desktop app. Use the returned id for every other command.',
    params: z.object({}),
    readOnly: true,
    run: () => listWorkspaces(),
  }),
  defineCommand({
    id: 'workspace.create',
    group: 'workspace',
    title: 'Create local workspace',
    description: 'Create an empty local workspace. Cloud workspaces are created in the desktop app.',
    params: z.object({ name: z.string().trim().min(1).max(160).describe('Workspace name') }),
    readOnly: false,
    run: ({ name }) => {
      const workspace: StoredWorkspace = {
        id: randomUUID(),
        cloudId: null,
        name,
        tree: [],
        baseTree: [],
        variables: emptyVariables(),
        baseVariables: emptyVariables(),
        activeEnvironmentId: null,
        baseCommitId: null,
        localHeadId: null,
      }
      insertWorkspace(workspace)
      return { id: workspace.id, name: workspace.name }
    },
  }),
  defineCommand({
    id: 'workspace.rename',
    group: 'workspace',
    title: 'Rename workspace',
    description: 'Change the name of a local workspace.',
    params: z.object({ workspaceId, name: z.string().trim().min(1).max(160) }),
    readOnly: false,
    run: ({ workspaceId: id, name }) => {
      const workspace = updateWorkspace(id, (current) => ({ ...current, name }))
      return { id, name: workspace.name }
    },
  }),
  defineCommand({
    id: 'workspace.delete',
    group: 'workspace',
    title: 'Delete local workspace',
    description: 'Delete a local workspace and its commit history. Requires confirm=true after the user confirms. Cloud workspaces are refused.',
    params: z.object({ workspaceId, confirm: z.literal(true).describe('Must be true; ask the user first') }),
    readOnly: false,
    destructive: true,
    run: ({ workspaceId: id }) => {
      const { workspace } = readWorkspace(id)
      deleteWorkspace(id)
      return { deleted: true, id, name: workspace.name }
    },
  }),
  defineCommand({
    id: 'tree.get',
    group: 'workspace',
    title: 'Read collection tree',
    description: 'Read the folder hierarchy and request summaries of a workspace. Credentials and secret-like values are redacted.',
    params: z.object({ workspaceId }),
    readOnly: true,
    run: ({ workspaceId: id }) => {
      const { workspace } = readWorkspace(id)
      return { workspaceId: id, workspaceName: workspace.name, tree: safeTree(workspace.tree) }
    },
  }),
]
