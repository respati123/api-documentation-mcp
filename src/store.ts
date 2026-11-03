import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { StoredWorkspace } from './types.js'

// The app's data folder. API_DOCS_USER_DATA_DIR overrides it, and it is read on each call so tests can point elsewhere.
export function dataDirectory(): string {
  const appName = 'api-documentation-bit'
  if (process.env.API_DOCS_USER_DATA_DIR) return process.env.API_DOCS_USER_DATA_DIR
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, appName)
}

let localDatabase: DatabaseSync | undefined
let openedPath: string | undefined

export function database(): DatabaseSync {
  const path = join(dataDirectory(), 'workspace.sqlite')
  if (!existsSync(path)) {
    throw new Error(`Workspace database was not found at ${path}. Open API Documentation once to create the local workspace.`)
  }
  if (!localDatabase || openedPath !== path) {
    localDatabase?.close()
    localDatabase = new DatabaseSync(path)
    localDatabase.exec('PRAGMA busy_timeout = 5000;')
    openedPath = path
  }
  return localDatabase
}

export function hashRaw(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// The account the desktop app is signed in to, written by the app to app_settings. Null when nobody is signed in, or the app predates accounts.
export const activeAccountKey = 'active-account'

export function activeAccountId(): string | null {
  try {
    const row = database().prepare('SELECT value FROM app_settings WHERE key = ?').get(activeAccountKey) as { value: string } | undefined
    return row?.value ?? null
  } catch (error) {
    if (error instanceof Error && /no such table/.test(error.message)) return null
    throw error
  }
}

// A workspace with no owner was saved before accounts existed, so every account can see it.
function visibleTo(workspace: StoredWorkspace, accountId: string | null): boolean {
  return !accountId || !workspace.accountId || workspace.accountId === accountId
}

export function listWorkspaces(): Array<{ id: string; name: string; cloudId: string | null; role: StoredWorkspace['role'] }> {
  const accountId = activeAccountId()
  const rows = database().prepare('SELECT data FROM workspaces ORDER BY rowid').all() as { data: string }[]
  return rows
    .map(({ data }) => JSON.parse(data) as StoredWorkspace)
    .filter((workspace) => visibleTo(workspace, accountId))
    .map((workspace) => ({ id: workspace.id, name: workspace.name, cloudId: workspace.cloudId ?? null, role: workspace.role ?? null }))
}

export function readWorkspace(workspaceId: string): { raw: string; workspace: StoredWorkspace } {
  const row = database().prepare('SELECT data FROM workspaces WHERE id = ?').get(workspaceId) as { data: string } | undefined
  if (!row) throw new Error(`Workspace "${workspaceId}" was not found.`)
  const workspace = JSON.parse(row.data) as StoredWorkspace
  if (!visibleTo(workspace, activeAccountId())) throw new Error(`Workspace "${workspaceId}" was not found.`)
  if (!Array.isArray(workspace.tree)) throw new Error('Workspace collection data is invalid.')
  return { raw: row.data, workspace }
}

export function assertCanEdit(workspace: StoredWorkspace): void {
  if (workspace.role === 'viewer') throw new Error('This workspace is read-only for the current account.')
  if (workspace.cloudId) throw new Error('Cloud copies are edited in the desktop app, then pushed to the cloud from there.')
}

// Reads, changes, and writes one workspace in a single immediate transaction, so two commands cannot interleave.
export function updateWorkspace(workspaceId: string, change: (workspace: StoredWorkspace, raw: string) => StoredWorkspace): StoredWorkspace {
  const db = database()
  db.exec('BEGIN IMMEDIATE;')
  try {
    const { raw, workspace } = readWorkspace(workspaceId)
    assertCanEdit(workspace)
    const next = change(workspace, raw)
    db.prepare('UPDATE workspaces SET data = ? WHERE id = ?').run(JSON.stringify(next), workspaceId)
    db.exec('COMMIT;')
    return next
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
}

export function insertWorkspace(workspace: StoredWorkspace): void {
  database().prepare('INSERT INTO workspaces (id, data) VALUES (?, ?)').run(workspace.id, JSON.stringify(workspace))
}

export function deleteWorkspace(workspaceId: string): void {
  const db = database()
  db.exec('BEGIN IMMEDIATE;')
  try {
    const { workspace } = readWorkspace(workspaceId)
    if (workspace.cloudId) throw new Error('Cloud workspaces are managed in the desktop app, not from the CLI.')
    db.prepare('DELETE FROM commits WHERE workspace_id = ?').run(workspaceId)
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
}

export function newWorkspaceId(): string {
  return randomUUID()
}
