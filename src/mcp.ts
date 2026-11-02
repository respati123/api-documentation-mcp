import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { allCommands, executeCommand } from './commands/index.js'
import { describeCommand } from './registry.js'

// Tool names cannot contain dots in every MCP client, so "request.send" is exposed as "request_send".
const toolName = (commandId: string) => commandId.replace(/\./g, '_')

// Older tool names keep working for clients configured before the command registry existed.
const legacyTools: Record<string, string> = {
  list_workspaces: 'workspace.list',
  get_collection_tree: 'tree.get',
  search_requests: 'request.search',
  get_request: 'request.get',
  preview_changes: 'changes.preview',
  apply_changes: 'changes.apply',
}

const instructions =
  'Drive the API Documentation desktop app: list workspaces, read and change collections, requests, environments, and variables, and send requests. Call list_commands first to see every command and its parameters. Search and read requests before changing them. Record known route, parameters, headers, body, auth, and response contracts, and do not invent missing details. Use {{baseUrl}} or other descriptive {{variableName}} references for environment-specific values, and {{accessToken}} for credentials. Never write a real secret: secret variables are created empty, and their values are entered in the desktop app. Changes to collections go through changes.preview; render the diff in chat (workspace, full collection paths, before and after for each field, nested deletion impact), ask the user to approve that exact preview, and stop. Never call changes.apply in the same turn as the preview. Destructive commands require confirm=true, which is only set after the user explicitly confirms.'

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'api-documentation-local', version: '0.2.0' }, { instructions })

  const register = (name: string, commandId: string, title: string, description: string) => {
    const command = allCommands.find((item) => item.id === commandId)
    if (!command) throw new Error(`Command ${commandId} is not registered.`)
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: command.params.shape,
        annotations: { readOnlyHint: command.readOnly, destructiveHint: command.destructive, openWorldHint: command.id === 'request.send' },
      },
      async (params: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(await executeCommand(commandId, params), null, 2) }] }),
    )
  }

  for (const command of allCommands) {
    register(toolName(command.id), command.id, command.title, command.description)
  }
  for (const [name, commandId] of Object.entries(legacyTools)) {
    const command = allCommands.find((item) => item.id === commandId)
    if (command) register(name, commandId, command.title, `${command.description} (Same as ${toolName(commandId)}.)`)
  }
  server.registerTool(
    'list_commands',
    {
      title: 'List commands',
      description: 'List every desktop app command with its parameters and whether it is read-only or destructive.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(allCommands.map(describeCommand), null, 2) }] }),
  )

  await server.connect(new StdioServerTransport())
}
