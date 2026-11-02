import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { allCommands, executeCommand } from '../commands/index.js'
import { describeParams } from '../registry.js'
import { readWorkspace, updateWorkspace } from '../store.js'

// Each run gets its own data folder with the same schema the desktop app creates.
const dataDir = mkdtempSync(join(tmpdir(), 'api-docs-cli-'))
process.env.API_DOCS_USER_DATA_DIR = dataDir
const db = new DatabaseSync(join(dataDir, 'workspace.sqlite'))
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS commits (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value BLOB NOT NULL);
`)
db.close()

let echo: Server
let baseUrl = ''
let workspaceId = ''

const run = (id: string, params: Record<string, unknown> = {}) => executeCommand(id, params)

async function workspaceFromCreate(): Promise<string> {
  const created = (await run('workspace.create', { name: 'Payments' })) as { id: string }
  return created.id
}

before(async () => {
  echo = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(201, { 'Content-Type': 'application/json', 'X-Echo-Auth': request.headers.authorization ?? '' })
      response.end(JSON.stringify({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString('utf8') }))
    })
  })
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', () => resolve()))
  const address = echo.address()
  baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
  workspaceId = await workspaceFromCreate()
})

after(() => {
  echo.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('command registry', () => {
  it('has unique ids and describes every parameter', () => {
    const ids = allCommands.map((command) => command.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const command of allCommands) assert.ok(describeParams(command.params).every((param) => param.name && param.type))
    assert.ok(ids.includes('commands.list'))
  })

  it('rejects an unknown command with a pointer to the list', async () => {
    await assert.rejects(run('nope.nothing'), /Unknown command/)
  })
})

describe('workspace and collection', () => {
  it('lists the created workspace', async () => {
    const list = (await run('workspace.list')) as Array<{ id: string; name: string }>
    assert.ok(list.some((item) => item.id === workspaceId && item.name === 'Payments'))
  })

  it('creates folders and requests and reads them back as a tree', async () => {
    const folder = (await run('folder.create', { workspaceId, parentId: null, name: 'Auth' })) as { id: string }
    const created = (await run('request.create', {
      workspaceId,
      parentId: folder.id,
      request: { name: 'Login', method: 'post', url: '{{baseUrl}}/login', body: '{"email":"a@b.c"}', bodyMode: 'json' },
    })) as { id: string; method: string }
    assert.equal(created.method, 'POST')
    const { tree } = (await run('tree.get', { workspaceId })) as { tree: Array<{ name: string; children?: Array<{ name: string }> }> }
    assert.equal(tree[0]?.name, 'Auth')
    assert.equal(tree[0]?.children?.[0]?.name, 'Login')
  })

  it('updates only the fields sent and keeps auth', async () => {
    const found = (await run('request.search', { workspaceId, query: 'login' })) as Array<{ id: string }>
    const id = found[0]?.id ?? ''
    await run('request.update', { workspaceId, requestId: id, patch: { url: '{{baseUrl}}/v2/login' } })
    const after = (await run('request.get', { workspaceId, requestId: id })) as { url: string; name: string }
    assert.equal(after.url, '{{baseUrl}}/v2/login')
    assert.equal(after.name, 'Login')
  })

  it('duplicates a request with new ids and a _copy name', async () => {
    const found = (await run('request.search', { workspaceId, query: 'login' })) as Array<{ id: string }>
    const original = found[0]?.id ?? ''
    const copy = (await run('request.duplicate', { workspaceId, requestId: original })) as { id: string; name: string }
    assert.notEqual(copy.id, original)
    assert.equal(copy.name, 'Login_copy')
  })

  it('refuses destructive commands without confirm=true', async () => {
    await assert.rejects(run('folder.delete', { workspaceId, folderId: 'x' }))
  })

  it('deletes a folder when confirmed', async () => {
    const created = (await run('folder.create', { workspaceId, parentId: null, name: 'Temp' })) as { id: string }
    await run('folder.delete', { workspaceId, folderId: created.id, confirm: true })
    const { tree } = (await run('tree.get', { workspaceId })) as { tree: Array<{ name: string }> }
    assert.ok(!tree.some((node) => node.name === 'Temp'))
  })

  it('moves a request into another folder', async () => {
    const target = (await run('folder.create', { workspaceId, parentId: null, name: 'Moved target' })) as { id: string }
    const found = (await run('request.search', { workspaceId, query: 'Login_copy' })) as Array<{ id: string }>
    await run('node.move', { workspaceId, nodeId: found[0]?.id ?? '', parentId: target.id })
    const copy = (await run('request.get', { workspaceId, requestId: found[0]?.id ?? '' })) as { id: string }
    assert.equal(copy.id, found[0]?.id)
  })
})

describe('environments and variables', () => {
  let environmentId = ''

  it('creates an environment and sets non-secret variables', async () => {
    environmentId = ((await run('environment.create', { workspaceId, name: 'staging' })) as { id: string }).id
    await run('variable.set', { workspaceId, scope: 'global', name: 'baseUrl', value: baseUrl })
    await run('variable.set', { workspaceId, scope: 'environment', environmentId, name: 'token', value: 'abc123' })
    const listed = (await run('environment.list', { workspaceId })) as { environments: Array<{ id: string; variables: Array<{ name: string; value: string }> }> }
    const staging = listed.environments.find((item) => item.id === environmentId)
    assert.equal(staging?.variables[0]?.value, 'abc123')
  })

  it('creates secret variables empty and refuses to set their values', async () => {
    await run('variable.set', { workspaceId, scope: 'environment', environmentId, name: 'clientSecret', secret: true })
    await assert.rejects(run('variable.set', { workspaceId, scope: 'environment', environmentId, name: 'clientSecret', value: 'nope' }), /is a secret/)
    const listed = (await run('environment.list', { workspaceId })) as { environments: Array<{ variables: Array<{ name: string; value: string; secret: boolean }> }> }
    const secret = listed.environments.flatMap((item) => item.variables).find((row) => row.name === 'clientSecret')
    assert.equal(secret?.secret, true)
    assert.equal(secret?.value, '<secret>')
  })

  it('activates an environment and duplicates it with a _copy name', async () => {
    await run('environment.activate', { workspaceId, environmentId })
    const copy = (await run('environment.duplicate', { workspaceId, environmentId })) as { name: string }
    assert.equal(copy.name, 'staging_copy')
  })
})

describe('changes preview and apply', () => {
  it('applies a previewed batch and refuses a stale one', async () => {
    const preview = (await run('changes.preview', {
      workspaceId,
      operations: [{ action: 'create_folder', parentId: null, name: 'Previewed' }],
    })) as { previewId: string; changes: unknown[] }
    assert.equal(preview.changes.length, 1)
    await run('changes.apply', { previewId: preview.previewId })
    const { tree } = (await run('tree.get', { workspaceId })) as { tree: Array<{ name: string }> }
    assert.ok(tree.some((node) => node.name === 'Previewed'))

    const stale = (await run('changes.preview', { workspaceId, operations: [{ action: 'create_folder', parentId: null, name: 'Stale' }] })) as { previewId: string }
    await run('folder.create', { workspaceId, parentId: null, name: 'Newer edit' })
    await assert.rejects(run('changes.apply', { previewId: stale.previewId }), /changed after this preview/)
  })

  it('refuses writes to a viewer workspace', async () => {
    const viewerId = (await run('workspace.create', { name: 'Shared view' })) as { id: string }
    updateWorkspace(viewerId.id, (workspace) => ({ ...workspace, role: 'viewer' }))
    await assert.rejects(run('folder.create', { workspaceId: viewerId.id, parentId: null, name: 'Nope' }), /read-only/)
  })
})

describe('request.send', () => {
  it('sends with variables and bearer auth from the chosen environment', async () => {
    const environments = (await run('environment.list', { workspaceId })) as { environments: Array<{ id: string; name: string }> }
    const staging = environments.environments.find((item) => item.name === 'staging')?.id ?? ''
    const request = (await run('request.create', {
      workspaceId,
      parentId: null,
      request: { name: 'Ping', method: 'GET', url: '{{baseUrl}}/ping', auth: { type: 'bearer', token: '{{token}}' } },
    })) as { id: string }
    const result = (await run('request.send', { workspaceId, requestId: request.id, environmentId: staging })) as { status: number; headers: Record<string, string>; body: string }
    assert.equal(result.status, 201)
    assert.equal(result.headers['x-echo-auth'], 'Bearer abc123')
    assert.equal(JSON.parse(result.body).path, '/ping')
  })

  it('names the variables that are missing instead of sending', async () => {
    const request = (await run('request.create', {
      workspaceId,
      parentId: null,
      request: { name: 'Needs secret', method: 'GET', url: '{{baseUrl}}/x', headers: [{ name: 'X-Key', value: '{{clientSecret}}', enabled: true }] },
    })) as { id: string }
    await assert.rejects(run('request.send', { workspaceId, requestId: request.id, environmentId: null }), /clientSecret/)
  })

  it('sends a urlencoded body from the form fields', async () => {
    const request = (await run('request.create', {
      workspaceId,
      parentId: null,
      request: {
        name: 'Form',
        method: 'POST',
        url: '{{baseUrl}}/form',
        bodyMode: 'urlencoded',
        bodyFields: [{ name: 'user', value: 'ana', enabled: true, type: 'text' }],
      },
    })) as { id: string }
    const result = (await run('request.send', { workspaceId, requestId: request.id, environmentId: null })) as { body: string }
    assert.equal(JSON.parse(result.body).body, 'user=ana')
  })
})

describe('request sections', () => {
  let id = ''
  it('creates a request and keeps {{variable}} references visible on read', async () => {
    const created = (await run('request.create', {
      workspaceId,
      parentId: null,
      request: { name: 'Orders', method: 'post', url: '{{baseUrl}}/orders', auth: { type: 'bearer', token: '{{accessToken}}' } },
    })) as { id: string }
    id = created.id
    const read = (await run('request.get', { workspaceId, requestId: id })) as { auth: { token: string } }
    assert.equal(read.auth.token, '{{accessToken}}')
  })

  it('hides a literal bearer token', async () => {
    await run('request.update', { workspaceId, requestId: id, patch: { auth: { type: 'bearer', token: 'eyJhbGciOi.literal' } } })
    const read = (await run('request.get', { workspaceId, requestId: id })) as { auth: { token: string } }
    assert.equal(read.auth.token, '<redacted>')
  })

  it('updates headers, params, body, responses, and docs in one patch and keeps auth', async () => {
    await run('request.update', {
      workspaceId,
      requestId: id,
      patch: {
        auth: { type: 'bearer', token: '{{accessToken}}' },
        headers: [{ name: 'X-Trace', value: '{{traceId}}', enabled: true }],
        params: [{ name: 'expand', value: 'items', enabled: true }],
        bodyMode: 'json',
        body: '{"sku":"A1"}',
        responses: [{ statusCode: '201', description: 'Created', content: [] }],
        documentation: 'Creates an order.',
      },
    })
    const read = (await run('request.get', { workspaceId, requestId: id })) as Record<string, unknown>
    assert.deepEqual(read.auth, { type: 'bearer', token: '{{accessToken}}' })
    assert.equal((read.headers as Array<{ value: string }>)[0]?.value, '{{traceId}}')
    assert.equal((read.params as Array<{ name: string }>)[0]?.name, 'expand')
    assert.equal(read.bodyMode, 'json')
    assert.equal((read.responses as Array<{ statusCode: string }>)[0]?.statusCode, '201')
    assert.equal(read.documentation, 'Creates an order.')
  })

  it('rejects an unknown body mode with a readable message', async () => {
    await assert.rejects(run('request.update', { workspaceId, requestId: id, patch: { bodyMode: 'soap' } }), /Invalid parameters: patch\.bodyMode/)
  })
})

describe('persistence', () => {
  it('keeps the stored workspace shape the desktop app reads', () => {
    const { workspace } = readWorkspace(workspaceId)
    assert.equal(workspace.cloudId, null)
    assert.ok(Array.isArray(workspace.tree))
    assert.ok(workspace.variables && Array.isArray(workspace.variables.environments))
    writeFileSync(join(dataDir, 'ok.txt'), 'ok')
  })
})
