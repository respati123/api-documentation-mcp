// The skill an MCP client reads before it changes anything. Write commands are refused until it has been read in this session.
export const guideText = `# API Documentation: how to build and change the workspace

Read this before any change. It sets how requests, variables, folders, and docs are made, so the result matches the API's real flows.

## 0. Start every task the same way
1. Call list_commands for the parameters and whether a command is read-only or destructive.
2. Read what exists first: workspace_list, tree_get, request_search, and request_get. Never create something that already exists under another name.
3. Read the variables that are already there with variable_get before you add one. Reuse a name that exists.
4. If the API contract is unknown, say what is unknown and ask. Do not guess a route, a field, or a status code.

## 1. Folders: one top-level folder per service
- Top level: one folder per service or segment of the API, named in Title Case: Auth, Users, Billing, Orders. Create it with folder_create and parentId null.
- Second level: one folder per business flow (for example "Checkout") or per resource (for example "Invoices"). Use a flow folder when several requests happen in order. Use a resource folder for standalone CRUD.
- Put requests that every service needs (health check, token refresh) in a "Shared" folder at the top level.
- Keep the tree at most three levels deep. Deeper nesting is hard to scan.
- Move an existing item with node_move. Rename a folder with folder_rename. Do not delete and recreate a folder to move it, because its requests lose their place.

## 2. Requests: name and order
- Name a request "METHOD resource action", for example "POST /invoices create". Keep the method visible in the name.
- In a flow folder, prefix each request with its step: "1 Create cart", "2 Add item", "3 Checkout". The order must match the real order of calls.

## 3. Auth: set it for every request that needs it
- Look at the endpoint's contract before you create the request.
- JWT or any Authorization header: auth type bearer, token {{accessToken}}. Never a literal token.
- API key: auth type api-key, with name, location (header or query), and value {{apiKey}}.
- Username and password: auth type basic, with {{username}} and {{password}}.
- Public endpoint: auth type none, and only when the contract says it is public.
- request_update keeps the existing auth unless you send auth again. When you change how a request is called, send auth again so it is set on purpose.
- Never write a real token, password, or key into a request. The variable holds it, and the value is entered in the app.

## 4. Variables: when a value becomes one
Make a variable when a value does at least one of these:
- It differs between environments, such as baseUrl, host, or tenantId. Use scope environment.
- It is the same in every request, such as apiVersion or a tenant header name. Use scope global.
- It is a credential, such as accessToken, apiKey, or password. Use secret true, with no value. The value is entered in the app.

Keep a literal value in the request when it is used once, does not change between environments, and is not a credential.

Naming: lowerCamelCase, specific, and the same name everywhere. Do not create baseUrl and base_url for the same thing.

Where a variable works: {{name}} resolves in the URL, params, headers, body, and auth when a request is sent. Globals apply everywhere. An active environment overrides a global of the same name. Set the active environment with environment_activate, and tell the user which one it is.

Writes: variable_set and variable_delete take the revision from variable_get as expectedRevision. Use null for a variable that does not exist yet. A stale revision is refused, so read again and retry.

## 5. Documentation: complete, and per business flow
Every request gets:
- Purpose: what the endpoint does, in one or two sentences.
- Place in the flow: "Step 2 of Checkout. Before: Create cart. After: Confirm order." Name the requests.
- Preconditions: what must be true first, and which variables must be set.
- Auth: which variable provides it.
- Request: each param, header, and body field, with its type, whether it is required, what it means, and a realistic example. Use {{variables}} in examples, never a real value.
- Responses: one entry per status code the contract lists, with an example body. Include the error responses: which code, which error body, and when it happens.
- Side effects: what changes on the server or in other requests.

Write it in the request's documentation field and its responses. Put the flow overview in the flow folder's first request. If a part is unknown, write "Unknown: ..." and ask the user. Do not fill it with a guess.

## 6. Changing collections: preview, ask, then apply
- Every change to folders, requests, or moves goes through changes_preview. Apply it with changes_apply only after the user approves that exact preview.
- Show the preview in chat: the workspace, the full path of each item, the before and after of each changed field, and what a deletion removes.
- Ask the user to approve it, then stop. Do not call changes_apply in the same turn as the preview.
- changes_apply refuses a preview when the workspace changed after it. Preview again.
- Direct write commands (request_create, request_update, folder_create, node_move) are for the user's explicit request, and still need the approval above.

## 7. Deleting and deprecating
- Prefer request_deprecate with a reason over deleting a request that other people may use.
- Delete only when the user asks, and set confirm=true only after the user has confirmed that exact deletion.

## 8. Sending requests
- Send only when the user asks. Say which environment is active first.
- A variable with no value stops the send, and the error names it. Fill it in the app, or ask.
- Do not send a request that changes data on a production server without asking.

## 9. Limits
- Cloud workspaces are read-only over MCP. Changes to a cloud copy are made in the desktop app.
- Viewer workspaces refuse writes.
- Secret values are never returned. environment_list shows them as <secret>.
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
