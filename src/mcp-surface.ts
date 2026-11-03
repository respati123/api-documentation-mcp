import { allCommands } from './commands/index.js'

// Collection edits reach an MCP client only through changes.preview and changes.apply, so the user sees the diff before anything is written.
// These commands stay in the CLI for scripts that run on purpose.
export const directCollectionWrites: ReadonlySet<string> = new Set([
  'folder.create',
  'folder.rename',
  'folder.delete',
  'node.move',
  'request.create',
  'request.update',
  'request.duplicate',
  'request.deprecate',
  'request.delete',
])

export function mcpCommands() {
  return allCommands.filter((command) => !directCollectionWrites.has(command.id))
}

// A send from an MCP client must name the URL it goes to, either with a dry run first or with confirmUrl. Returns the reason to refuse, or null.
export function missingTargetConfirmation(commandId: string, params: Record<string, unknown>): string | null {
  if (commandId !== 'request.send') return null
  if (params.dryRun === true || typeof params.confirmUrl === 'string') return null
  return 'Run request.send with dryRun set to true first, show the URL to the user, then send with confirmUrl set to that URL.'
}
