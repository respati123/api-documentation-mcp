import { readFileSync } from 'node:fs'
import { allCommands, executeCommand } from './commands/index.js'
import { describeCommand } from './registry.js'

const usage = `api-documentation-mcp: drive the API Documentation desktop app from the command line or an AI agent

USAGE:
  api-documentation-mcp commands [--json] [--filter TEXT]   list every command and its parameters
  api-documentation-mcp call <command> [json-params]        run one command, print its JSON result
  api-documentation-mcp run <script.json|-> [--json]        run a JSON array or JSON lines of {"command", "params"}
  api-documentation-mcp mcp                                 start the MCP server (stdio); also the default with no arguments
  api-documentation-mcp help

Commands read and write the app's local workspace database. Keep the desktop app open to see changes live.
Destructive commands need "confirm": true, and collection writes that go through changes.preview need changes.apply.`

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function parseParams(text: string | undefined): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Parameters must be JSON, for example '{"workspaceId":"..."}'.`)
  }
}

function listCommands(args: string[]): void {
  const filterAt = args.indexOf('--filter')
  const filter = filterAt >= 0 ? args[filterAt + 1]?.toLocaleLowerCase() : undefined
  const commands = allCommands
    .map(describeCommand)
    .filter((command) => !filter || `${command.id} ${command.title} ${command.description}`.toLocaleLowerCase().includes(filter))
  if (args.includes('--json')) return printJson(commands)
  for (const command of commands) {
    const flags = [command.readOnly ? 'read-only' : 'write', command.destructive ? 'destructive' : null].filter(Boolean).join(', ')
    const params = command.params.map((param) => `${param.name}${param.required ? '' : '?'}`).join(' ')
    process.stdout.write(`${command.id.padEnd(24)} ${command.title} [${flags}]\n  ${params}\n`)
  }
}

function readScript(path: string): unknown[] {
  const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8')
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as unknown[]
  return trimmed.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown)
}

// Runs steps in order and prints one JSON line per step. A failed step is reported, and the run continues with the next one.
async function runScript(path: string | undefined): Promise<void> {
  if (!path) throw new Error('run needs a script path, or - for stdin.')
  const steps = readScript(path)
  let failures = 0
  for (const [index, step] of steps.entries()) {
    const { command, params } = (step ?? {}) as { command?: unknown; params?: unknown }
    if (typeof command !== 'string') {
      failures += 1
      process.stdout.write(`${JSON.stringify({ step: index + 1, ok: false, error: 'Each step needs a "command" string.' })}\n`)
      continue
    }
    try {
      const result = await executeCommand(command, params ?? {})
      process.stdout.write(`${JSON.stringify({ step: index + 1, command, ok: true, result })}\n`)
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      process.stdout.write(`${JSON.stringify({ step: index + 1, command, ok: false, error: message })}\n`)
    }
  }
  if (failures) process.exitCode = 1
}

export async function runCli(args: string[]): Promise<void> {
  const [name, ...rest] = args
  if (name === 'help' || name === '--help' || name === '-h') return void process.stdout.write(`${usage}\n`)
  if (name === 'commands') return listCommands(rest)
  if (name === 'call') {
    const [command, params] = rest
    if (!command) throw new Error('call needs a command id. Run "api-documentation-mcp commands" to list them.')
    return printJson(await executeCommand(command, parseParams(params)))
  }
  if (name === 'run') return runScript(rest.find((item) => !item.startsWith('--')))
  throw new Error(`Unknown subcommand "${name}".\n\n${usage}`)
}
