import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SavedResponseSnapshot } from './response-references.js'

// The same files the desktop app writes: responses/<workspaceId>/<requestId>.json. Only the last 200 response of each request is kept.
// These files hold response bodies and headers, which can contain tokens. They are never returned whole, and they are never synced.
export const savedResponseStatus = 200
export const maxSavedBodyBytes = 1024 * 1024

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

const savedResponseSchema = z.object({
  savedAt: z.string(),
  status: z.literal(savedResponseStatus),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  truncated: z.boolean(),
})

export type SavedResponseSummary = { requestId: string; savedAt: string; status: number; statusText: string; truncated: boolean }

function assertSafeId(kind: 'workspace' | 'request', id: string): void {
  if (!idPattern.test(id)) throw new Error(`The ${kind} id cannot be used to save a response.`)
}

export function responseFilePath(dataDir: string, workspaceId: string, requestId: string): string {
  assertSafeId('workspace', workspaceId)
  assertSafeId('request', requestId)
  return join(dataDir, 'responses', workspaceId, `${requestId}.json`)
}

// Writes a temporary file and renames it, so a reader never sees a half-written file.
// Returns false, and writes nothing, when the status is not 200.
export async function saveResponse(
  dataDir: string,
  input: { workspaceId: string; requestId: string; status: number; statusText: string; headers: Record<string, string>; body: string },
  now: Date = new Date(),
): Promise<boolean> {
  if (input.status !== savedResponseStatus) return false
  const file = responseFilePath(dataDir, input.workspaceId, input.requestId)
  const bytes = Buffer.from(input.body, 'utf8')
  const truncated = bytes.byteLength > maxSavedBodyBytes
  const saved = {
    savedAt: now.toISOString(),
    status: savedResponseStatus,
    statusText: input.statusText,
    headers: input.headers,
    body: truncated ? bytes.subarray(0, maxSavedBodyBytes).toString('utf8') : input.body,
    truncated,
  }
  await mkdir(join(dataDir, 'responses', input.workspaceId), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(saved), { flag: 'wx' })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return true
}

// Undefined when the request has never been saved. Throws when the file exists but is not valid.
export async function readSavedResponse(dataDir: string, workspaceId: string, requestId: string): Promise<SavedResponseSnapshot | undefined> {
  const file = responseFilePath(dataDir, workspaceId, requestId)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`The saved response for "${requestId}" is not valid JSON.`)
  }
  const parsed = savedResponseSchema.safeParse(json)
  if (!parsed.success) throw new Error(`The saved response for "${requestId}" has an unexpected format.`)
  return parsed.data
}

// Lists the saved responses of one workspace without their bodies. A file that cannot be read is skipped.
export async function listSavedResponses(dataDir: string, workspaceId: string): Promise<SavedResponseSummary[]> {
  assertSafeId('workspace', workspaceId)
  let names: string[]
  try {
    names = await readdir(join(dataDir, 'responses', workspaceId))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  const summaries = await Promise.all(
    names
      .filter((name) => name.endsWith('.json') && idPattern.test(name.slice(0, -'.json'.length)))
      .map(async (name): Promise<SavedResponseSummary | undefined> => {
        const requestId = name.slice(0, -'.json'.length)
        try {
          const saved = await readSavedResponse(dataDir, workspaceId, requestId)
          if (!saved) return undefined
          return { requestId, savedAt: saved.savedAt, status: saved.status, statusText: saved.statusText, truncated: saved.truncated }
        } catch {
          return undefined
        }
      }),
  )
  return summaries
    .filter((summary): summary is SavedResponseSummary => summary !== undefined)
    .sort((left, right) => left.requestId.localeCompare(right.requestId))
}
