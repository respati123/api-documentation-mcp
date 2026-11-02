import { randomUUID } from 'node:crypto'
import { findNode, findParentId, insertNode, isFolder, normalizeRequest, removeNode, updateNode } from './tree.js'
import { summarize } from './redact.js'
import type { ChangeOperation, PlannedChange, SyncTreeNode } from './types.js'

export type OperationResult = { tree: SyncTreeNode[]; summary: PlannedChange['summary'][number] }

// Applies one collection operation and describes it for a preview. The same code runs for direct commands and for previewed batches.
export function applyOperation(tree: SyncTreeNode[], operation: ChangeOperation): OperationResult {
  if (operation.action === 'create_folder') {
    const parent = operation.parentId ? findNode(tree, operation.parentId) : undefined
    if (operation.parentId && (!parent || !isFolder(parent))) throw new Error(`Parent folder "${operation.parentId}" was not found.`)
    const folder = { id: randomUUID(), kind: 'folder' as const, name: operation.name.trim(), children: [] }
    return { tree: insertNode(tree, operation.parentId, folder), summary: { action: operation.action, target: folder.name, after: summarize(folder) } }
  }
  if (operation.action === 'create_request') {
    const parent = operation.parentId ? findNode(tree, operation.parentId) : undefined
    if (operation.parentId && (!parent || !isFolder(parent))) throw new Error(`Parent folder "${operation.parentId}" was not found.`)
    const request = normalizeRequest(operation.request)
    return { tree: insertNode(tree, operation.parentId, request), summary: { action: operation.action, target: request.name, after: summarize(request) } }
  }
  if (operation.action === 'update_request') {
    const before = findNode(tree, operation.requestId)
    if (!before || isFolder(before)) throw new Error(`Request "${operation.requestId}" was not found.`)
    const updated = normalizeRequest(
      { ...before, ...operation.patch, name: operation.patch.name ?? before.name, method: operation.patch.method ?? before.method, url: operation.patch.url ?? before.url },
      before,
    )
    const result = updateNode(tree, operation.requestId, () => updated)
    return { tree: result.tree, summary: { action: operation.action, target: updated.name, before: summarize(before), after: summarize(updated) } }
  }
  if (operation.action === 'rename_folder') {
    const before = findNode(tree, operation.folderId)
    if (!before || !isFolder(before)) throw new Error(`Folder "${operation.folderId}" was not found.`)
    const result = updateNode(tree, operation.folderId, (node) => (isFolder(node) ? { ...node, name: operation.name.trim() } : node))
    return {
      tree: result.tree,
      summary: { action: operation.action, target: operation.name.trim(), before: summarize(before), after: { ...(summarize(before) as object), name: operation.name.trim() } },
    }
  }
  if (operation.action === 'move_node') {
    const before = findNode(tree, operation.nodeId)
    if (!before) throw new Error(`Collection item "${operation.nodeId}" was not found.`)
    const parent = operation.parentId ? findNode(tree, operation.parentId) : undefined
    if (operation.parentId && (!parent || !isFolder(parent))) throw new Error(`Parent folder "${operation.parentId}" was not found.`)
    if (isFolder(before) && (before.id === operation.parentId || findNode(before.children, operation.parentId ?? '')?.kind === 'folder'))
      throw new Error('A folder cannot be moved inside itself or one of its descendants.')
    const oldParentId = findParentId(tree, before.id)
    const removed = removeNode(tree, before.id)
    if (!removed.removed) throw new Error(`Collection item "${operation.nodeId}" could not be moved.`)
    const next = insertNode(removed.tree, operation.parentId, removed.removed, operation.index)
    return { tree: next, summary: { action: operation.action, target: before.name, before: { parentId: oldParentId }, after: { parentId: operation.parentId, index: operation.index } } }
  }
  if (operation.action === 'deprecate_request') {
    const before = findNode(tree, operation.requestId)
    if (!before || isFolder(before)) throw new Error(`Request "${operation.requestId}" was not found.`)
    const updated = {
      ...before,
      deprecated: operation.deprecated,
      ...(operation.deprecated && operation.reason?.trim() ? { deprecationReason: operation.reason.trim() } : {}),
      ...(!operation.deprecated ? { deprecationReason: undefined } : {}),
    }
    const result = updateNode(tree, operation.requestId, () => updated)
    return {
      tree: result.tree,
      summary: {
        action: operation.action,
        target: updated.name,
        before: { deprecated: before.deprecated === true, deprecationReason: before.deprecationReason },
        after: { deprecated: updated.deprecated, deprecationReason: updated.deprecationReason },
      },
    }
  }
  const before = findNode(tree, operation.nodeId)
  if (!before) throw new Error(`Collection item "${operation.nodeId}" was not found.`)
  const removed = removeNode(tree, operation.nodeId)
  return { tree: removed.tree, summary: { action: operation.action, target: before.name, before: summarize(before) } }
}

export function applyOperations(tree: SyncTreeNode[], operations: ChangeOperation[]): { tree: SyncTreeNode[]; summary: PlannedChange['summary'] } {
  let next = tree
  const summary: PlannedChange['summary'] = []
  for (const operation of operations) {
    const result = applyOperation(next, operation)
    next = result.tree
    summary.push(result.summary)
  }
  return { tree: next, summary }
}
