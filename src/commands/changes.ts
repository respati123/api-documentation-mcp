import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { applyOperations } from '../operations.js'
import { defineCommand } from '../registry.js'
import { hashRaw, readWorkspace, updateWorkspace } from '../store.js'
import { operationSchema } from '../schemas.js'
import type { PlannedChange } from '../types.js'

// Previewed batches wait here for a short time. apply_changes refuses them if the workspace changed since the preview.
const plans = new Map<string, PlannedChange>()
const planLifetimeMs = 10 * 60 * 1000

export const changeCommands = [
  defineCommand({
    id: 'changes.preview',
    group: 'changes',
    title: 'Preview collection changes',
    description:
      'Validate a batch of collection operations and return sanitized before/after data without changing anything. Show the preview to the user, then call changes.apply only after they approve it.',
    params: z.object({ workspaceId: z.string().min(1), operations: z.array(operationSchema).min(1).max(100) }),
    readOnly: true,
    run: ({ workspaceId: id, operations }) => {
      const { raw, workspace } = readWorkspace(id)
      if (workspace.role === 'viewer') throw new Error('This workspace is read-only for the current account.')
      const result = applyOperations(structuredClone(workspace.tree), operations)
      const previewId = randomUUID()
      const plan: PlannedChange = {
        id: previewId,
        workspaceId: id,
        sourceHash: hashRaw(raw),
        operations,
        nextTree: result.tree,
        summary: result.summary,
        includesDelete: operations.some((operation) => operation.action === 'delete_node'),
        expiresAt: Date.now() + planLifetimeMs,
      }
      plans.set(previewId, plan)
      return {
        previewId,
        workspaceId: id,
        workspaceName: workspace.name,
        changes: result.summary,
        deletesItems: plan.includesDelete,
        expiresInSeconds: planLifetimeMs / 1000,
      }
    },
  }),
  defineCommand({
    id: 'changes.apply',
    group: 'changes',
    title: 'Apply previewed changes',
    description: 'Apply a batch returned by changes.preview. Only call after the user approved that exact preview. Requires confirmDelete=true when the batch deletes anything.',
    params: z.object({ previewId: z.string().min(1), confirmDelete: z.boolean().default(false) }),
    readOnly: false,
    destructive: true,
    run: ({ previewId, confirmDelete }) => {
      const plan = plans.get(previewId)
      if (!plan || plan.expiresAt < Date.now()) {
        plans.delete(previewId)
        throw new Error('This preview expired or was not found. Run changes.preview again.')
      }
      if (plan.includesDelete && !confirmDelete) {
        throw new Error('This batch includes deletion. Ask the user to confirm the listed deletions, then retry with confirmDelete=true.')
      }
      const updated = updateWorkspace(plan.workspaceId, (workspace, raw) => {
        if (hashRaw(raw) !== plan.sourceHash) {
          throw new Error('The workspace changed after this preview. Run changes.preview again to avoid overwriting newer edits.')
        }
        return { ...workspace, tree: structuredClone(plan.nextTree) }
      })
      plans.delete(previewId)
      return { applied: true, workspaceId: plan.workspaceId, workspaceName: updated.name, changes: plan.summary }
    },
  }),
]
