import type { SyncRequest, StoredWorkspace, WorkspaceVariable } from './types.js'
import { sanitizeUrl } from './redact.js'

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

function fill(text: string, values: Map<string, string>, missing: Set<string>): string {
  return text.replace(variablePattern, (match, name: string) => {
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

export async function sendRequest(request: SyncRequest, workspace: StoredWorkspace, environmentId: string | null) {
  const { values, blocked } = resolveVariables(workspace, environmentId)
  const missing = new Set<string>()
  const f = (text: string) => fill(text, values, missing)
  const headers = new Headers({ Accept: '*/*', 'User-Agent': 'API-Documentation-CLI/0.2.0' })
  for (const header of request.headers ?? []) {
    if (header.enabled && header.name.trim()) headers.set(f(header.name.trim()), f(header.value))
  }

  const url = new URL(f(request.url))
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

  let body: string | undefined
  const mode = request.bodyMode ?? 'none'
  if (mode === 'urlencoded') {
    const form = new URLSearchParams()
    for (const field of request.bodyFields ?? []) if (field.enabled && field.type === 'text') form.append(f(field.name), f(field.value))
    body = form.toString()
    headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
  } else if (mode === 'form-data' || mode === 'file') {
    throw new Error(`request.send does not send ${mode} bodies yet. Send this request from the desktop app.`)
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
  const started = Date.now()
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  return {
    status: response.status,
    statusText: response.statusText,
    url: sanitizeUrl(response.url || url.toString()),
    durationMs: Date.now() - started,
    headers: Object.fromEntries(response.headers.entries()),
    body: text.length > maxBodyChars ? text.slice(0, maxBodyChars) : text,
    bodyTruncated: text.length > maxBodyChars,
  }
}
