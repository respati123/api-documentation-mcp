import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { maxSavedBodyBytes, listSavedResponses, readSavedResponse, responseFilePath, saveResponse } from '../saved-responses.js'
import { referencedRequestIds, resolveResponseReference, type SavedResponseSnapshot } from '../response-references.js'
import { sendRequest } from '../send.js'
import type { StoredWorkspace, SyncRequest } from '../types.js'
import { variableNameSchema } from '../schemas.js'

const login: SavedResponseSnapshot = {
  savedAt: '2026-11-10T10:00:00.000Z',
  status: 200,
  statusText: 'OK',
  headers: { location: '/users/1' },
  body: JSON.stringify({ data: { accessToken: 'abc.def', id: 7, roles: ['admin', 'dev'], nothing: null } }),
  truncated: false,
}

const saved = new Map<string, SavedResponseSnapshot>([
  ['login', login],
  ['big', { ...login, body: '{"data":"cut"}', truncated: true }],
  ['list', { ...login, body: JSON.stringify([{ id: 'first' }, { id: 'second' }]) }],
  ['text', { ...login, body: 'plain text' }],
])

describe('variable names', () => {
  it('refuses a variable name that starts with the reserved response. prefix', () => {
    assert.equal(variableNameSchema.safeParse('response.login').success, false)
    assert.equal(variableNameSchema.safeParse('baseUrl').success, true)
  })
})

describe('referencedRequestIds', () => {
  it('lists each request id once, in order of first use', () => {
    assert.deepEqual(referencedRequestIds('{{response.login.body.$.a}} {{response.list.raw}} {{ response.login.header.x }}'), ['login', 'list'])
  })
})

describe('resolveResponseReference', () => {
  it('reads a JSON value, an array item, and a number, boolean, null, or object', () => {
    assert.equal(resolveResponseReference('response.login.body.$.data.accessToken', saved), 'abc.def')
    assert.equal(resolveResponseReference('response.list.body.$[1].id', saved), 'second')
    assert.equal(resolveResponseReference('response.login.body.$.data.id', saved), '7')
    assert.equal(resolveResponseReference('response.login.body.$.data.roles', saved), '["admin","dev"]')
    assert.equal(resolveResponseReference('response.login.body.$.data.nothing', saved), 'null')
  })

  it('reads the raw body and one header, ignoring the case of the header name', () => {
    assert.equal(resolveResponseReference('response.text.raw', saved), 'plain text')
    assert.equal(resolveResponseReference('response.login.header.Location', saved), '/users/1')
  })

  it('stops with a clear error when the request has never been saved', () => {
    assert.throws(() => resolveResponseReference('response.never.body.$.id', saved), /Request "never" has no saved response yet/)
  })

  it('stops when the saved body was truncated', () => {
    assert.throws(() => resolveResponseReference('response.big.raw', saved), /larger than 1 MB/)
  })

  it('names the path that is missing, and refuses a path it does not support', () => {
    assert.throws(() => resolveResponseReference('response.login.body.$.data.missing', saved), /Path \$\.data\.missing was not found/)
    assert.throws(() => resolveResponseReference("response.login.body.$['data']", saved), /is not supported/)
    assert.throws(() => resolveResponseReference('response.login.body.data.id', saved), /must start with \$/)
  })

  it('refuses a request id that is not a plain id, and an unknown attribute', () => {
    assert.throws(() => resolveResponseReference('response...body.$.x', saved), /is not a valid request id/)
    assert.throws(() => resolveResponseReference('response.login.url', saved), /Unknown response attribute "url"/)
  })
})

describe('saved response files', () => {
  let dataDir = ''
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mcp-saved-'))
  })
  after(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('writes one file per request, reads it back, and lists it without the body', async () => {
    assert.equal(await saveResponse(dataDir, { workspaceId: 'local-default', requestId: 'login', status: 200, statusText: 'OK', headers: {}, body: '{"a":1}' }), true)

    const read = await readSavedResponse(dataDir, 'local-default', 'login')
    assert.equal(read?.body, '{"a":1}')
    assert.deepEqual(await listSavedResponses(dataDir, 'local-default'), [
      { requestId: 'login', savedAt: read?.savedAt, status: 200, statusText: 'OK', truncated: false },
    ])
  })

  it('does not save a response that is not 200, and marks an oversized body as truncated', async () => {
    assert.equal(await saveResponse(dataDir, { workspaceId: 'w', requestId: 'r', status: 500, statusText: 'Error', headers: {}, body: 'x' }), false)
    await saveResponse(dataDir, { workspaceId: 'w', requestId: 'r', status: 200, statusText: 'OK', headers: {}, body: 'a'.repeat(maxSavedBodyBytes + 1) })

    const read = await readSavedResponse(dataDir, 'w', 'r')
    assert.equal(read?.truncated, true)
    assert.equal(Buffer.byteLength(read?.body ?? ''), maxSavedBodyBytes)
  })

  it('refuses an unsafe id, and skips a broken file when listing', async () => {
    await assert.rejects(readSavedResponse(dataDir, '../x', 'r'), /cannot be used/)
    await saveResponse(dataDir, { workspaceId: 'w', requestId: 'good', status: 200, statusText: 'OK', headers: {}, body: '{}' })
    mkdirSync(join(dataDir, 'responses', 'w'), { recursive: true })
    writeFileSync(responseFilePath(dataDir, 'w', 'bad'), '{"status":"no"}')

    assert.deepEqual((await listSavedResponses(dataDir, 'w')).map((item) => item.requestId), ['good'])
    assert.deepEqual(readdirSync(join(dataDir, 'responses', 'w')).sort(), ['bad.json', 'good.json'])
  })
})

describe('sendRequest with a saved response reference', () => {
  let echo: Server
  let echoUrl = ''
  let dataDir = ''
  const previous = process.env.API_DOCS_USER_DATA_DIR

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mcp-send-'))
    process.env.API_DOCS_USER_DATA_DIR = dataDir
    echo = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        // A session route answers like a login: it returns a token, which the send must hide.
        if (request.url?.startsWith('/session')) response.end(JSON.stringify({ ok: true, accessToken: 'live-token' }))
        else response.end(JSON.stringify({ path: request.url, received: request.headers.authorization ?? null, body: Buffer.concat(chunks).toString() }))
      })
    })
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
    const address = echo.address()
    echoUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
    await saveResponse(dataDir, {
      workspaceId: 'ws1',
      requestId: 'login',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ data: { accessToken: 'live-token', id: 7 } }),
    })
  })

  after(async () => {
    await new Promise<void>((resolve) => echo.close(() => resolve()))
    if (previous === undefined) delete process.env.API_DOCS_USER_DATA_DIR
    else process.env.API_DOCS_USER_DATA_DIR = previous
    rmSync(dataDir, { recursive: true, force: true })
  })

  const workspace = { id: 'ws1', tree: [], variables: { globals: [], environments: [] }, activeEnvironmentId: null } as unknown as StoredWorkspace
  const request = (overrides: Partial<SyncRequest>) =>
    ({ id: 'me', kind: 'request', name: 'Me', method: 'GET', url: `${echoUrl}/users/{{response.login.body.$.data.id}}`, headers: [], params: [], ...overrides }) as SyncRequest

  it('fills the URL and the auth from the saved response, and sends the real value', async () => {
    const result = (await sendRequest(
      request({
        url: `${echoUrl}/users/{{response.login.body.$.data.id}}`,
        auth: { type: 'bearer', token: '{{response.login.body.$.data.accessToken}}' },
      }),
      workspace,
      null,
    )) as { status: number; body: string }

    const echoed = JSON.parse(result.body) as { path: string; received: string }
    assert.equal(echoed.path, '/users/7')
    assert.equal(echoed.received, 'Bearer live-token')
  })

  it('redacts a token in the response body that the send returns', async () => {
    const result = (await sendRequest(request({ url: `${echoUrl}/session` }), workspace, null)) as { body: string }
    assert.equal(result.body.includes('live-token'), false)
    assert.equal(JSON.parse(result.body).accessToken, '<redacted>')
  })

  it('stops before sending when the referred request has not been saved', async () => {
    await assert.rejects(
      sendRequest(request({ url: `${echoUrl}/{{response.never.body.$.id}}` }), workspace, null),
      /Request "never" has no saved response yet/,
    )
  })

  it('saves the response of a successful send, so other requests can refer to it', async () => {
    await sendRequest(request({ id: 'echo-me', url: `${echoUrl}/saved` }), workspace, null)

    const read = await readSavedResponse(dataDir, 'ws1', 'echo-me')
    assert.equal(read?.status, 200)
    assert.match(read?.body ?? '', /\/saved/)
  })
})

