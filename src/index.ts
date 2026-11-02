import { runCli } from './cli.js'
import { startMcpServer } from './mcp.js'

// No arguments and "mcp" start the MCP server, as this package always has. Other arguments are CLI subcommands.
const args = process.argv.slice(2)

const main = args.length === 0 || args[0] === 'mcp' ? startMcpServer() : runCli(args)

main.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
