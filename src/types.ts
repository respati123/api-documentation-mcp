export type BodyMode = 'form-data' | 'urlencoded' | 'graphql' | 'json' | 'xml' | 'yaml' | 'edn' | 'text' | 'other' | 'file' | 'none'
export type HeaderField = { id?: string; name: string; value: string; enabled: boolean; description?: string }
export type ParamField = { id?: string; name: string; value: string; enabled: boolean; description?: string }
export type BodyField = { id?: string; name: string; value: string; enabled: boolean; type: 'text' | 'file'; filePath?: string; fileName?: string }
export type RequestAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api-key'; name: string; value: string; location: 'header' | 'query' }
export type ResponseContent = { id?: string; mediaType: string; schema: string; example: string }
export type ResponseDefinition = { id?: string; statusCode: string; description: string; content: ResponseContent[] }

export type SyncRequest = {
  id: string
  kind: 'request'
  name: string
  method: string
  url: string
  body: string
  bodyMode?: BodyMode
  bodyFields?: BodyField[]
  bodyVariables?: string
  bodyMimeType?: string
  bodyPath?: string
  bodyFileName?: string
  headers?: HeaderField[]
  params?: ParamField[]
  pathParams?: ParamField[]
  auth?: RequestAuth
  documentation?: string
  preScript?: string
  postScript?: string
  responses?: ResponseDefinition[]
  openApiSchemas?: Record<string, unknown>
  deprecated?: boolean
  deprecationReason?: string
}
export type SyncFolder = { id: string; kind: 'folder'; name: string; children: SyncTreeNode[] }
export type SyncTreeNode = SyncRequest | SyncFolder

export type WorkspaceVariable = { id: string; name: string; value: string; secret: boolean }
export type WorkspaceEnvironment = { id: string; name: string; variables: WorkspaceVariable[] }
export type WorkspaceVariables = { globals: WorkspaceVariable[]; environments: WorkspaceEnvironment[] }

// Fields may arrive without an id; normalizeRequest gives every stored item one.
// The stored workspace row. Fields the CLI does not own are kept as they are.
export type StoredWorkspace = {
  id: string
  cloudId: string | null
  name: string
  tree: SyncTreeNode[]
  baseTree?: SyncTreeNode[]
  variables?: WorkspaceVariables
  baseVariables?: WorkspaceVariables
  activeEnvironmentId?: string | null
  baseCommitId?: string | null
  localHeadId?: string | null
  role?: 'owner' | 'editor' | 'viewer' | null
  // The account that owns this copy on the device. Null or missing means it predates accounts.
  accountId?: string | null
  [key: string]: unknown
}

export type CreateFolderOperation = { action: 'create_folder'; parentId: string | null; name: string }
export type CreateRequestOperation = { action: 'create_request'; parentId: string | null; request: Partial<SyncRequest> & Pick<SyncRequest, 'name' | 'method' | 'url'> }
export type UpdateRequestOperation = { action: 'update_request'; requestId: string; patch: Partial<SyncRequest> }
export type RenameFolderOperation = { action: 'rename_folder'; folderId: string; name: string }
export type MoveNodeOperation = { action: 'move_node'; nodeId: string; parentId: string | null; index?: number }
export type DeprecateRequestOperation = { action: 'deprecate_request'; requestId: string; deprecated: boolean; reason?: string }
export type DeleteNodeOperation = { action: 'delete_node'; nodeId: string }
export type ChangeOperation =
  | CreateFolderOperation
  | CreateRequestOperation
  | UpdateRequestOperation
  | RenameFolderOperation
  | MoveNodeOperation
  | DeprecateRequestOperation
  | DeleteNodeOperation

export type PlannedChange = {
  id: string
  workspaceId: string
  sourceHash: string
  operations: ChangeOperation[]
  nextTree: SyncTreeNode[]
  summary: Array<{ action: string; target: string; before?: unknown; after?: unknown }>
  includesDelete: boolean
  expiresAt: number
}
