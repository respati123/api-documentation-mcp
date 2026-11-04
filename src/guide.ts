// The guide an MCP client reads before it changes anything. Write commands are refused until the guide has been read in this session.
export const guideText = `# Using the API Documentation app through MCP

## Start
- Call list_commands to see every command, its parameters, and whether it is read-only or destructive.
- Read before you change. Search and read requests with request_search and request_get, and read the tree with tree_get. Do not guess what is already there.

## Record what is known, and nothing else
- Record the route, parameters, headers, body, auth, and responses that are known. Do not invent a missing contract. Say what is unknown instead.
- Use {{baseUrl}} or another descriptive {{variableName}} for environment-specific values, and {{accessToken}} for credentials.
- Never write a real secret. Secret variables are created empty, and their values are entered in the desktop app. environment_list shows a secret as <secret>.

## Collection changes: preview, then ask, then apply
- Collection edits go through changes_preview. Apply them with changes_apply only after the user approves that exact preview.
- Show the preview in chat: the workspace, the full collection path of each item, the before and after of each changed field, and what a deletion would remove.
- Ask the user to approve it, then stop. Do not call changes_apply in the same turn as the preview.
- changes_apply refuses a preview when the workspace changed after it. Preview again instead of forcing it.

## Variables
- Read a variable with variable_get and pass its revision as expectedRevision to variable_set or variable_delete. A stale revision is refused, so re-read first.

## Destructive commands
- Commands that delete need confirm=true. Set it only after the user has confirmed that exact deletion.

## Limits
- Cloud workspaces are read-only over MCP. Changes to a cloud copy are made in the desktop app.
- Viewer workspaces refuse writes.
- request_send sends the request for real. A variable with no value stops the send, and the error names it. Ask before sending a request that changes data on a server.
`

export interface GuideGate {
  markRead(): void
  // The reason a command is refused, or null when it may run.
  refusal(command: { readOnly: boolean }): string | null
}

export function createGuideGate(): GuideGate {
  let read = false
  return {
    markRead() {
      read = true
    },
    refusal(command) {
      if (command.readOnly || read) return null
      return 'Read the guide first: call the guide tool, then retry this command.'
    },
  }
}
