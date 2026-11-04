# api-documentation-mcp

Command-line and MCP access to the API Documentation desktop app. Every command reads and writes the same local workspace database the app uses, so an agent or a script can create workspaces, folders, requests, environments, and variables, and send requests, without anyone clicking through the app. The app picks changes up while it is open.

The desktop app must be installed and opened at least once on this computer.

## Use with an AI client (MCP)

```json
{
  "mcpServers": {
    "api-documentation": {
      "command": "npx",
      "args": ["-y", "api-documentation-mcp@latest"]
    }
  }
}
```

For Codex:

```
codex mcp add api-documentation -- npx -y api-documentation-mcp@latest
```

Requires Node.js 22 or newer. Start with `list_commands` to see every command and its parameters.

Version 0.2.0 is not on npm yet. Until it is published, point the client at a local build: `node /path/to/mcp/dist/index.js` after `npm run build`. The `npx` form above installs the published version.

## Use from the command line

```
api-documentation-mcp commands                       # every command, read-only or write, destructive or not
api-documentation-mcp commands --json --filter env   # JSON, filtered
api-documentation-mcp call workspace.list
api-documentation-mcp call workspace.create '{"name":"Payments"}'
api-documentation-mcp run script.json                # JSON array or JSON lines of {"command","params"}
cat steps.jsonl | api-documentation-mcp run -        # from stdin
```

`run` executes steps in order and prints one JSON line per step. A failed step is reported and the run continues. Exit code is 1 when any step failed.

## Data location

- Linux: `~/.config/api-documentation-bit`
- macOS: `~/Library/Application Support/api-documentation-bit`
- Windows: `%APPDATA%\api-documentation-bit`

Set `API_DOCS_USER_DATA_DIR` if the app uses a custom data folder.

## Commands

| Group | Commands |
|---|---|
| workspace | `workspace.list`, `workspace.create`, `workspace.rename`, `workspace.delete`, `tree.get` |
| collection | `folder.create`, `folder.rename`, `folder.delete`, `node.move` |
| request | `request.search`, `request.get`, `request.create`, `request.update`, `request.duplicate`, `request.deprecate`, `request.delete`, `request.send` |
| environment | `environment.list`, `environment.create`, `environment.rename`, `environment.duplicate`, `environment.delete`, `environment.activate`, `variable.set`, `variable.delete` |
| changes | `changes.preview`, `changes.apply` |
| meta | `commands.list` |

Destructive commands (`*.delete`) require `"confirm": true`. Only set it after the user confirms.

Collection edits go through `changes.preview` and then `changes.apply`. Apply refuses a preview when the workspace changed after it, so nothing newer is overwritten.

MCP clients do not get the direct collection writes (`folder.*`, `node.move`, `request.create`, `request.update`, `request.duplicate`, `request.deprecate`, `request.delete`). They stay in the CLI for scripts. Sending a request from an MCP client needs `dryRun: true` first, then `confirmUrl` set to the URL it showed.

## Limits and safety

- Secret values are never returned. `environment.list` shows them as `<secret>`. Request params, headers, body, auth, responses, and docs all go through `request.create` and `request.update`. Literal tokens in a request are shown as `<redacted>`, but `{{variable}}` references are shown as written, so an agent can see that auth uses `{{accessToken}}`.
- A secret variable is created empty when `variable.set` gets `"secret": true` with no value. Its value is entered in the desktop app. An existing secret cannot be changed from the CLI.
- Variable writes are checked against what was read. `variable.get` returns a `revision`. `variable.set` and `variable.delete` take `expectedRevision` and refuse the write if the variable changed since then. The revision of a secret covers its stored form, so a secret the app sets again also counts as a change. MCP clients must pass `expectedRevision`, using `null` for a variable that does not exist yet.
- Cloud workspaces are read from the CLI but not created, renamed, or deleted from it. Cloud copies also refuse edits: change them in the desktop app and push from there, so nothing is left unpushed.
- Viewer workspaces refuse writes.
- Accounts: the desktop app writes the signed-in account id to `app_settings`. Workspaces the CLI creates get that account, and the CLI shows and edits only the active account's workspaces plus workspaces that predate accounts. With no account signed in, every workspace is visible.
- Writes to the workspace database are not coordinated with the app. The CLI's own writes are atomic, but an edit the app saves during a CLI write can overwrite it. Keep the app idle while the CLI writes, then check the result in the app.
- `request.send` sends JSON, text, XML, YAML, GraphQL, and urlencoded bodies, with bearer, basic, and API-key auth. Multipart and file bodies must be sent from the app. Path parameters are not substituted yet.
- Variables from the active environment (or the one you pass) and globals are filled in. A variable with no value stops the send and names what is missing.

## Legacy tool names

These tools keep working for clients configured earlier: `list_workspaces`, `get_collection_tree`, `search_requests`, `get_request`, `preview_changes`, `apply_changes`.

## Development

```
npm ci
npm run typecheck
npm test
npm run build
```
