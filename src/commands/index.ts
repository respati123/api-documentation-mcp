import { defineCommand, describeCommand, type Command } from '../registry.js'
import { z } from 'zod'
import { changeCommands } from './changes.js'
import { collectionCommands } from './collection.js'
import { environmentCommands } from './environments.js'
import { requestCommands } from './requests.js'
import { workspaceCommands } from './workspace.js'

const listCommand = defineCommand({
  id: 'commands.list',
  group: 'meta',
  title: 'List commands',
  description: 'List every command with its parameters, so an agent can discover what the desktop app can do. Filter with a text query.',
  params: z.object({ filter: z.string().trim().max(200).optional().describe('Text to match in id, title, or description') }),
  readOnly: true,
  run: ({ filter }) => {
    const needle = filter?.toLocaleLowerCase()
    return allCommands
      .filter((command) => !needle || `${command.id} ${command.title} ${command.description}`.toLocaleLowerCase().includes(needle))
      .map(describeCommand)
  },
})

// Every command the desktop app supports from the CLI and MCP. Add a command here once and every surface picks it up.
export const allCommands: Command[] = [
  listCommand,
  ...workspaceCommands,
  ...collectionCommands,
  ...requestCommands,
  ...environmentCommands,
  ...changeCommands,
]

export function findCommand(id: string): Command {
  const command = allCommands.find((item) => item.id === id)
  if (!command) throw new Error(`Unknown command "${id}". Run "api-documentation-mcp commands" to list them.`)
  return command
}

export async function executeCommand(id: string, params: unknown): Promise<unknown> {
  return findCommand(id).run(params)
}
