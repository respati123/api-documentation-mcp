import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SyncRequest, StoredWorkspace, WorkspaceVariable } from './types.js'
import { isSensitiveName, maskSecret, redactBody, sanitizeUrl } from './redact.js'
import { dataDirectory } from './store.js'
import { referencedRequestIds, resolveResponseReference, responsePrefix, type SavedResponseSnapshot } from './response-references.js'
import { readSavedResponse, saveResponse } from './saved-responses.js'

const timeoutMs = 30_000
const maxBodyChars = 1_000_000
const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g

// Non-secret values from globals, then the chosen environment overrides them. Secret values live in the app's encrypted store, so they never resolve here.
function resolveVariables(workspace: StoredWorkspace, environmentId: string | null): { values: Map<string, string>; blocked: Set<string> } {
  const variables = workspace.variables ?? { globals: [], environments: [] }
  const environment = variables.environments.find((item) => item.id === (environmentId ?? workspace.activeEnvironmentId ?? ''))
  const rows: WorkspaceVariable[] = [...variables.globals, ...(environment?.variables ?? [])]
  const values = new Map<string, string>()
  const blocked = new Set<string>()
  for (const row of rows) {
    if (row.secret || row.value === '') {
      blocked.add(row.name)
      values.delete(row.name)
    } else {
      values.set(row.name, row.value)
      blocked.delete(row.name)
    }
  }
  return { values, blocked }
}

// Loads the saved responses that the request's {{response.<id>...}} references use. Only those are read.
async function loadReferencedResponses(workspaceId: string, request: SyncRequest): Promise<Map<string, SavedResponseSnapshot>> {
  const savedResponses = new Map<string, SavedResponseSnapshot>()
  for (const requestId of referencedRequestIds(JSON.stringify(request))) {
    const saved = await readSavedResponse(dataDirectory(), workspaceId, requestId)
    if (saved) savedResponses.set(requestId, saved)
  }
  return savedResponses
}

// A reference to a saved response is filled from that response. A reference that cannot be resolved stops the send with its error.
function fill(text: string, values: Map<string, string>, missing: Set<string>, savedResponses: Map<string, SavedResponseSnapshot>): string {
  return text.replace(variablePattern, (match, name: string) => {
    if (name.startsWith(responsePrefix)) return resolveResponseReference(name, savedResponses)
    const value = values.get(name)
    if (value === undefined) {
      missing.add(name)
      return match
    }
    return value
  })
}

const defaultMime: Record<string, string> = {
  json: 'application/json',
  graphql: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  edn: 'application/edn',
  text: 'text/plain',
  other: 'text/plain',
}

export type SendOptions = {
  // Return the URL the request would call, without sending it.
  dryRun?: boolean
  // Send only when the URL this request goes to is exactly this one, as shown by a dry run.
  confirmUrl?: string
}

export async function sendRequest(request: SyncRequest, workspace: StoredWorkspace, environmentId: string | null, options: SendOptions = {}) {
  const { values, blocked } = resolveVariables(workspace, environmentId)
  const missing = new Set<string>()
  const savedResponses = await loadReferencedResponses(workspace.id, request)
  const f = (text: string) => fill(text, values, missing, savedResponses)
  const headers = new Headers({ Accept: '*/*', 'User-Agent': 'API-Documentation-CLI/0.4.0' })
  for (const header of request.headers ?? []) {
    if (header.enabled && header.name.trim()) headers.set(f(header.name.trim()), f(header.value))
  }

  const url = new URL(f(request.url))
  // A path segment such as :id takes the value of the enabled path parameter with that name. A segment with no value is reported as missing.
  url.pathname = url.pathname
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1)
      const param = (request.pathParams ?? []).find((item) => item.enabled && item.name.trim() === name)
      if (!param) {
        missing.add(name)
        return segment
      }
      return encodeURIComponent(f(param.value))
    })
    .join('/')
  for (const param of request.params ?? []) {
    if (param.enabled && param.name.trim()) url.searchParams.append(f(param.name.trim()), f(param.value))
  }

  const auth = request.auth ?? { type: 'none' as const }
  if (auth.type === 'bearer') headers.set('Authorization', `Bearer ${f(auth.token)}`)
  if (auth.type === 'basic') headers.set('Authorization', `Basic ${Buffer.from(`${f(auth.username)}:${f(auth.password)}`).toString('base64')}`)
  if (auth.type === 'api-key') {
    if (auth.location === 'query') url.searchParams.set(f(auth.name), f(auth.value))
    else headers.set(f(auth.name), f(auth.value))
  }

  let body: string | Blob | FormData | undefined
  const mode = request.bodyMode ?? 'none'
  if (mode === 'urlencoded') {
    const form = new URLSearchParams()
    for (const field of request.bodyFields ?? []) if (field.enabled && field.type === 'text') form.append(f(field.name), f(field.value))
    body = form.toString()
    headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
  } else if (mode === 'form-data') {
    const form = new FormData()
    for (const field of request.bodyFields ?? []) {
      if (!field.enabled) continue
      if (field.type === 'text') form.append(f(field.name), f(field.value))
      else if (field.filePath) form.append(f(field.name), new Blob([await readFile(field.filePath)]), field.fileName || basename(field.filePath))
    }
    // fetch sets the multipart Content-Type with its boundary, so no header is set here.
    body = form
  } else if (mode === 'file') {
    if (!request.bodyPath) throw new Error('This request has no file to send as its body.')
    body = new Blob([await readFile(request.bodyPath)])
    if (!headers.has('Content-Type')) headers.set('Content-Type', request.bodyMimeType || 'application/octet-stream')
  } else if (mode !== 'none' && request.body) {
    body = f(request.body)
    if (!headers.has('Content-Type')) headers.set('Content-Type', request.bodyMimeType || defaultMime[mode] || 'text/plain')
  }

  // Only names this request actually uses are checked. A secret that the request does not reference is not a blocker.
  if (missing.size) {
    const names = [...missing]
    const secretNames = names.filter((name) => blocked.has(name))
    const hint = secretNames.length ? ` Enter the secret values (${secretNames.join(', ')}) in the desktop app.` : ''
    throw new Error(`Variables need a value before sending: ${names.join(', ')}.${hint} Set other values with variable.set.`)
  }

  const method = request.method.toUpperCase()
  const target = sanitizeUrl(url.toString())
  if (options.dryRun) return { dryRun: true as const, method, url: target }
  if (options.confirmUrl !== undefined && options.confirmUrl !== target) {
    throw new Error(`The target changed. This request now goes to ${target}. Confirm that URL with a dry run before sending.`)
  }
  const started = Date.now()
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  const responseHeaders = Object.fromEntries(response.headers.entries())
  // A 200 response is kept for later references. Saving is best effort: it never fails the send.
  await saveResponse(dataDirectory(), { workspaceId: workspace.id, requestId: request.id, status: response.status, statusText: response.statusText, headers: responseHeaders, body: text }).catch(() => false)
  // What goes back to the client is redacted: a token in a header or a JSON body is hidden.
  return {
    status: response.status,
    statusText: response.statusText,
    url: sanitizeUrl(response.url || url.toString()),
    durationMs: Date.now() - started,
    headers: Object.fromEntries(Object.entries(responseHeaders).map(([name, value]) => [name, isSensitiveName(name) ? maskSecret(value) : value])),
    body: redactBody(text.length > maxBodyChars ? text.slice(0, maxBodyChars) : text),
    bodyTruncated: text.length > maxBodyChars,
  }
}
