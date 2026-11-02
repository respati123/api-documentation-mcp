import { randomUUID } from 'node:crypto'
import type { SyncFolder, SyncRequest, SyncTreeNode } from './types.js'

export function isFolder(node: SyncTreeNode): node is SyncFolder {
  return node.kind === 'folder'
}

export function findNode(nodes: SyncTreeNode[], id: string): SyncTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (isFolder(node)) {
      const nested = findNode(node.children, id)
      if (nested) return nested
    }
  }
  return undefined
}

export function findRequest(nodes: SyncTreeNode[], id: string): SyncRequest {
  const node = findNode(nodes, id)
  if (!node || isFolder(node)) throw new Error(`Request "${id}" was not found.`)
  return node
}

export function findParentId(nodes: SyncTreeNode[], id: string, parentId: string | null = null): string | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parentId
    if (isFolder(node)) {
      const nested = findParentId(node.children, id, node.id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

export function insertNode(nodes: SyncTreeNode[], parentId: string | null, node: SyncTreeNode, index?: number): SyncTreeNode[] {
  if (parentId === null) {
    const next = [...nodes]
    next.splice(index === undefined ? next.length : Math.min(index, next.length), 0, node)
    return next
  }
  const insertInto = (siblings: SyncTreeNode[]): { nodes: SyncTreeNode[]; found: boolean } => {
    for (let position = 0; position < siblings.length; position += 1) {
      const child = siblings[position]
      if (!isFolder(child)) continue
      if (child.id === parentId) {
        const children = [...child.children]
        children.splice(index === undefined ? children.length : Math.min(index, children.length), 0, node)
        const next = [...siblings]
        next[position] = { ...child, children }
        return { nodes: next, found: true }
      }
      const nested = insertInto(child.children)
      if (nested.found) {
        const next = [...siblings]
        next[position] = { ...child, children: nested.nodes }
        return { nodes: next, found: true }
      }
    }
    return { nodes: siblings, found: false }
  }
  const result = insertInto(nodes)
  if (!result.found) throw new Error(`Parent folder "${parentId}" was not found.`)
  return result.nodes
}

export function removeNode(nodes: SyncTreeNode[], id: string): { tree: SyncTreeNode[]; removed?: SyncTreeNode } {
  const directIndex = nodes.findIndex((node) => node.id === id)
  if (directIndex >= 0) {
    const next = [...nodes]
    const [removed] = next.splice(directIndex, 1)
    return { tree: next, removed }
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!isFolder(node)) continue
    const result = removeNode(node.children, id)
    if (!result.removed) continue
    const next = [...nodes]
    next[index] = { ...node, children: result.tree }
    return { tree: next, removed: result.removed }
  }
  return { tree: nodes }
}

export function updateNode(nodes: SyncTreeNode[], id: string, update: (node: SyncTreeNode) => SyncTreeNode): { tree: SyncTreeNode[]; found: boolean } {
  let found = false
  const tree = nodes.map((node) => {
    if (node.id === id) {
      found = true
      return update(node)
    }
    if (!isFolder(node)) return node
    const nested = updateNode(node.children, id, update)
    if (!nested.found) return node
    found = true
    return { ...node, children: nested.tree }
  })
  return { tree, found }
}

export function requestList(nodes: SyncTreeNode[]): SyncRequest[] {
  return nodes.flatMap((node) => (isFolder(node) ? requestList(node.children) : [node]))
}

// Copies a node with fresh ids for the node and everything under it.
export function cloneWithNewIds(node: SyncTreeNode): SyncTreeNode {
  if (isFolder(node)) return { ...node, id: randomUUID(), children: node.children.map(cloneWithNewIds) }
  return {
    ...node,
    id: randomUUID(),
    headers: node.headers?.map((item) => ({ ...item, id: randomUUID() })),
    params: node.params?.map((item) => ({ ...item, id: randomUUID() })),
    pathParams: node.pathParams?.map((item) => ({ ...item, id: randomUUID() })),
    bodyFields: node.bodyFields?.map((item) => ({ ...item, id: randomUUID() })),
  }
}

export function normalizeRequest(input: Partial<SyncRequest> & Pick<SyncRequest, 'name' | 'method' | 'url'>, existing?: SyncRequest): SyncRequest {
  const headers = input.headers ?? existing?.headers ?? []
  const params = input.params ?? existing?.params ?? []
  const pathParams = input.pathParams ?? existing?.pathParams ?? []
  const bodyFields = input.bodyFields ?? existing?.bodyFields ?? []
  const responses = input.responses ?? existing?.responses ?? []
  return {
    ...existing,
    ...input,
    id: existing?.id ?? input.id ?? randomUUID(),
    kind: 'request',
    name: input.name,
    method: input.method.toUpperCase(),
    url: input.url,
    body: input.body ?? existing?.body ?? '',
    headers: headers.map((item) => ({ ...item, id: item.id || randomUUID() })),
    params: params.map((item) => ({ ...item, id: item.id || randomUUID() })),
    pathParams: pathParams.map((item) => ({ ...item, id: item.id || randomUUID() })),
    bodyFields: bodyFields.map((item) => ({ ...item, id: item.id || randomUUID() })),
    responses: responses.map((response) => ({
      ...response,
      id: response.id || randomUUID(),
      content: response.content.map((content) => ({ ...content, id: content.id || randomUUID() })),
    })),
  }
}
