import { z } from 'zod'
import { applyOperation } from '../operations.js'
import { defineCommand } from '../registry.js'
import { updateWorkspace } from '../store.js'

const workspaceId = z.string().min(1).describe('Workspace id from workspace.list')
const folderId = z.string().min(1).describe('Folder id from tree.get')
const nodeId = z.string().min(1).describe('Folder or request id from tree.get')
const parentId = z.string().nullable().default(null).describe('Parent folder id, or null for the root')
const confirm = z.literal(true).describe('Must be true; ask the user first')

export const collectionCommands = [
  defineCommand({
    id: 'folder.create',
    group: 'collection',
    title: 'Create folder',
    description: 'Create a folder under a parent folder, or at the root when parentId is null.',
    params: z.object({ workspaceId, parentId, name: z.string().trim().min(1).max(160) }),
    readOnly: false,
    run: ({ workspaceId: id, parentId: parent, name }) => {
      let created: unknown
      updateWorkspace(id, (workspace) => {
        const result = applyOperation(workspace.tree, { action: 'create_folder', parentId: parent, name })
        created = result.summary.after
        return { ...workspace, tree: result.tree }
      })
      return created
    },
  }),
  defineCommand({
    id: 'folder.rename',
    group: 'collection',
    title: 'Rename folder',
    description: 'Rename a folder.',
    params: z.object({ workspaceId, folderId, name: z.string().trim().min(1).max(160) }),
    readOnly: false,
    run: ({ workspaceId: id, folderId: folder, name }) => {
      updateWorkspace(id, (workspace) => ({ ...workspace, tree: applyOperation(workspace.tree, { action: 'rename_folder', folderId: folder, name }).tree }))
      return { renamed: true, folderId: folder, name }
    },
  }),
  defineCommand({
    id: 'folder.delete',
    group: 'collection',
    title: 'Delete folder',
    description: 'Delete a folder and everything in it. Requires confirm=true after the user confirms the listed deletions.',
    params: z.object({ workspaceId, folderId, confirm }),
    readOnly: false,
    destructive: true,
    run: ({ workspaceId: id, folderId: folder }) => {
      updateWorkspace(id, (workspace) => ({ ...workspace, tree: applyOperation(workspace.tree, { action: 'delete_node', nodeId: folder }).tree }))
      return { deleted: true, folderId: folder }
    },
  }),
  defineCommand({
    id: 'node.move',
    group: 'collection',
    title: 'Move folder or request',
    description: 'Move a folder or request under another folder (or the root), optionally at a position.',
    params: z.object({ workspaceId, nodeId, parentId, index: z.number().int().min(0).optional() }),
    readOnly: false,
    run: ({ workspaceId: id, nodeId: node, parentId: parent, index }) => {
      updateWorkspace(id, (workspace) => ({
        ...workspace,
        tree: applyOperation(workspace.tree, { action: 'move_node', nodeId: node, parentId: parent, index }).tree,
      }))
      return { moved: true, nodeId: node, parentId: parent, index: index ?? null }
    },
  }),
]
