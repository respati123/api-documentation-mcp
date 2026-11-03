import { z } from 'zod'
import { applyOperation } from '../operations.js'
import { requestFields } from '../schemas.js'
import { cloneWithNewIds, findParentId, findRequest, insertNode, requestList } from '../tree.js'
import { defineCommand } from '../registry.js'
import { safeRequest } from '../redact.js'
import { readWorkspace, updateWorkspace } from '../store.js'
import { sendRequest } from '../send.js'
import { z as zod } from 'zod'

const workspaceId = z.string().min(1).describe('Workspace id from workspace.list')
const requestId = z.string().min(1).describe('Request id from tree.get or request.search')
const parentId = z.string().nullable().default(null).describe('Folder id, or null for the root')
const confirm = z.literal(true).describe('Must be true; ask the user first')

export const requestCommands = [
  defineCommand({
    id: 'request.search',
    group: 'request',
    title: 'Search requests',
    description: 'Search request names, methods, URLs, documentation, and response descriptions. Sensitive URL values are masked.',
    params: z.object({ workspaceId, query: z.string().trim().min(1).max(200) }),
    readOnly: true,
    run: ({ workspaceId: id, query }) => {
      const { workspace } = readWorkspace(id)
      const needle = query.toLocaleLowerCase()
      return requestList(workspace.tree)
        .filter((request) => {
          const haystack = [request.name, request.method, request.url, request.documentation ?? '', ...(request.responses ?? []).map((item) => item.description)]
          return haystack.join('\n').toLocaleLowerCase().includes(needle)
        })
        .map((request) => safeRequest(request))
    },
  }),
  defineCommand({
    id: 'request.get',
    group: 'request',
    title: 'Read request',
    description: 'Read one request definition: params, body, auth, headers, documented responses, and documentation. Literal secrets are redacted; {{variable}} references are shown as written.',
    params: z.object({ workspaceId, requestId }),
    readOnly: true,
    run: ({ workspaceId: id, requestId: request }) => safeRequest(findRequest(readWorkspace(id).workspace.tree, request)),
  }),
  defineCommand({
    id: 'request.create',
    group: 'request',
    title: 'Create request',
    description: 'Create a request under a folder, or at the root when parentId is null. Use {{variableName}} for environment-specific values.',
    params: z.object({ workspaceId, parentId, request: z.object(requestFields) }),
    readOnly: false,
    run: ({ workspaceId: id, parentId: parent, request }) => {
      let created: unknown
      updateWorkspace(id, (workspace) => {
        const result = applyOperation(workspace.tree, { action: 'create_request', parentId: parent, request })
        created = result.summary.after
        return { ...workspace, tree: result.tree }
      })
      return created
    },
  }),
  defineCommand({
    id: 'request.update',
    group: 'request',
    title: 'Update request',
    description: 'Change fields of a request. Only the fields you send are changed; existing auth is kept unless you send auth.',
    params: z.object({ workspaceId, requestId, patch: z.object(requestFields).partial() }),
    readOnly: false,
    run: ({ workspaceId: id, requestId: request, patch }) => {
      updateWorkspace(id, (workspace) => ({
        ...workspace,
        tree: applyOperation(workspace.tree, { action: 'update_request', requestId: request, patch }).tree,
      }))
      return { updated: true, requestId: request }
    },
  }),
  defineCommand({
    id: 'request.duplicate',
    group: 'request',
    title: 'Duplicate request',
    description: 'Copy a request into the same folder as "<name>_copy", with new ids, and return the copy.',
    params: z.object({ workspaceId, requestId }),
    readOnly: false,
    run: ({ workspaceId: id, requestId: request }) => {
      let copyResult: unknown
      updateWorkspace(id, (workspace) => {
        const original = findRequest(workspace.tree, request)
        const parent = findParentId(workspace.tree, original.id) ?? null
        const copy = { ...cloneWithNewIds(original), name: `${original.name}_copy` }
        copyResult = safeRequest(copy as typeof original)
        return { ...workspace, tree: insertNode(workspace.tree, parent, copy) }
      })
      return copyResult
    },
  }),
  defineCommand({
    id: 'request.deprecate',
    group: 'request',
    title: 'Mark request deprecated',
    description: 'Mark a request as deprecated (or clear it) with an optional reason.',
    params: z.object({ workspaceId, requestId, deprecated: z.boolean(), reason: z.string().max(4096).optional() }),
    readOnly: false,
    run: ({ workspaceId: id, requestId: request, deprecated, reason }) => {
      updateWorkspace(id, (workspace) => ({
        ...workspace,
        tree: applyOperation(workspace.tree, { action: 'deprecate_request', requestId: request, deprecated, reason }).tree,
      }))
      return { requestId: request, deprecated }
    },
  }),
  defineCommand({
    id: 'request.delete',
    group: 'request',
    title: 'Delete request',
    description: 'Delete a request. Requires confirm=true after the user confirms.',
    params: z.object({ workspaceId, requestId, confirm }),
    readOnly: false,
    destructive: true,
    run: ({ workspaceId: id, requestId: request }) => {
      updateWorkspace(id, (workspace) => ({ ...workspace, tree: applyOperation(workspace.tree, { action: 'delete_node', nodeId: request }).tree }))
      return { deleted: true, requestId: request }
    },
  }),
  defineCommand({
    id: 'request.send',
    group: 'request',
    title: 'Send request',
    description:
      'Send a request over HTTP and return status, headers, and body. {{variables}} are filled from the active or given environment and globals. Secret variables must be set in the desktop app first.',
    params: z.object({
      workspaceId,
      requestId,
      environmentId: z.string().min(1).nullable().optional().describe('Environment id; defaults to the active one, or null for none'),
      dryRun: z.boolean().optional().describe('Return the URL the request would call, without sending it'),
      confirmUrl: z.string().min(1).optional().describe('Send only if the request still goes to this URL, as shown by a dry run'),
    }),
    readOnly: false,
    run: async ({ workspaceId: id, requestId: request, environmentId, dryRun, confirmUrl }) => {
      const { workspace } = readWorkspace(id)
      return sendRequest(findRequest(workspace.tree, request), workspace, environmentId ?? null, { dryRun, confirmUrl })
    },
  }),
]


