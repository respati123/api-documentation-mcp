import type { SyncFolder, SyncRequest, SyncTreeNode } from './types.js'
import { isFolder } from './tree.js'

// A {{variable}} reference is not a secret, so it stays visible. Only literal values are hidden.
const referencePattern = /^\s*\{\{[^{}]+\}\}\s*$/
export function maskSecret(value: string): string {
  return referencePattern.test(value) ? value : '<redacted>'
}

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) url.username = '<redacted>'
    if (url.password) url.password = '<redacted>'
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key)) url.searchParams.set(key, maskSecret(url.searchParams.get(key) ?? ''))
    }
    return url.toString()
  } catch {
    return value
  }
}

export function isSensitiveName(value: string): boolean {
  return /authorization|cookie|token|secret|password|\bkey\b|api[-_]?key|client[-_]?secret/i.test(value)
}

export function redactBody(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value)
    const redact = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(redact)
      if (!item || typeof item !== 'object') return item
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, isSensitiveName(key) ? '<redacted>' : redact(entry)]))
    }
    return JSON.stringify(redact(parsed), null, 2)
  } catch {
    return value.replace(
      /\b(authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret|key)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^,\r\n;}]+)/gi,
      '$1: <redacted>',
    )
  }
}

export function safeRequest(request: SyncRequest): SyncRequest {
  return {
    ...request,
    url: sanitizeUrl(request.url),
    body: redactBody(request.body),
    ...(request.documentation ? { documentation: redactBody(request.documentation) } : {}),
    ...(request.responses
      ? {
          responses: request.responses.map((response) => ({
            ...response,
            content: response.content.map((content) => ({ ...content, example: redactBody(content.example) })),
          })),
        }
      : {}),
    ...(request.openApiSchemas ? { openApiSchemas: JSON.parse(redactBody(JSON.stringify(request.openApiSchemas))) as Record<string, unknown> } : {}),
    ...(request.headers ? { headers: request.headers.map((header) => ({ ...header, value: isSensitiveName(header.name) ? maskSecret(header.value) : header.value })) } : {}),
    ...(request.params ? { params: request.params.map((param) => ({ ...param, value: isSensitiveName(param.name) ? maskSecret(param.value) : param.value })) } : {}),
    ...(request.pathParams ? { pathParams: request.pathParams.map((param) => ({ ...param, value: isSensitiveName(param.name) ? maskSecret(param.value) : param.value })) } : {}),
    ...(request.bodyFields
      ? { bodyFields: request.bodyFields.map((field) => ({ ...field, value: isSensitiveName(field.name) ? maskSecret(field.value) : field.value, filePath: undefined })) }
      : {}),
    ...(request.auth?.type === 'bearer' ? { auth: { type: 'bearer', token: maskSecret(request.auth.token) } } : {}),
    ...(request.auth?.type === 'basic'
      ? { auth: { type: 'basic', username: maskSecret(request.auth.username), password: maskSecret(request.auth.password) } }
      : {}),
    ...(request.auth?.type === 'api-key' ? { auth: { ...request.auth, value: maskSecret(request.auth.value) } } : {}),
    bodyPath: undefined,
  }
}

export function safeTree(nodes: SyncTreeNode[]): unknown[] {
  return nodes.map((node) =>
    isFolder(node)
      ? { id: node.id, kind: node.kind, name: node.name, children: safeTree(node.children) }
      : { id: node.id, kind: node.kind, name: node.name, method: node.method, url: sanitizeUrl(node.url), deprecated: node.deprecated === true },
  )
}

export function summarize(node: SyncTreeNode | undefined): unknown {
  if (!node) return undefined
  return isFolder(node) ? ({ id: node.id, kind: node.kind, name: node.name, childCount: (node as SyncFolder).children.length }) : safeRequest(node)
}
