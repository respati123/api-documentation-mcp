import { z } from 'zod'

export const bodyModes = ['form-data', 'urlencoded', 'graphql', 'json', 'xml', 'yaml', 'edn', 'text', 'other', 'file', 'none'] as const

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().max(65536) }),
  z.object({ type: z.literal('basic'), username: z.string().max(8192), password: z.string().max(65536) }),
  z.object({ type: z.literal('api-key'), name: z.string().max(8192), value: z.string().max(65536), location: z.enum(['header', 'query']) }),
])

export const fieldSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(8192),
  value: z.string().max(65536),
  enabled: z.boolean().default(true),
  description: z.string().max(4096).optional(),
})

export const bodyFieldSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(8192),
  value: z.string().max(65536),
  enabled: z.boolean().default(true),
  type: z.enum(['text', 'file']).default('text'),
  fileName: z.string().max(1024).optional(),
})

export const responseContentSchema = z.object({
  id: z.string().optional(),
  mediaType: z.string().max(160),
  schema: z.string().max(1_000_000),
  example: z.string().max(1_000_000),
})

export const responseDefinitionSchema = z.object({
  id: z.string().optional(),
  statusCode: z.string().trim().min(1).max(12),
  description: z.string().max(500),
  content: z.array(responseContentSchema).max(20),
})

const method = z.string().trim().min(1).max(32).transform((value) => value.toUpperCase())

export const requestFields = {
  name: z.string().trim().min(1).max(160),
  method,
  url: z.string().max(8192),
  body: z.string().max(1_000_000).optional(),
  bodyMode: z.enum(bodyModes).optional(),
  bodyFields: z.array(bodyFieldSchema).max(100).optional(),
  bodyVariables: z.string().max(1_000_000).optional(),
  bodyMimeType: z.string().max(1024).optional(),
  bodyFileName: z.string().max(1024).optional(),
  headers: z.array(fieldSchema).max(100).optional(),
  params: z.array(fieldSchema).max(100).optional(),
  pathParams: z.array(fieldSchema).max(100).optional(),
  auth: authSchema.optional(),
  documentation: z.string().max(100_000).optional(),
  preScript: z.string().max(50_000).optional().describe('JavaScript that runs before the request is sent. Uses the apidocs object.'),
  postScript: z.string().max(50_000).optional().describe('JavaScript that runs after the response arrives. Uses the apidocs object.'),
  responses: z.array(responseDefinitionSchema).max(100).optional(),
  deprecated: z.boolean().optional(),
  deprecationReason: z.string().max(4096).optional(),
}

export const requestSchema = z.object(requestFields)
export const requestPatchSchema = z.object(requestFields).partial()

export const operationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_folder'), parentId: z.string().nullable().default(null), name: z.string().trim().min(1).max(160) }),
  z.object({ action: z.literal('create_request'), parentId: z.string().nullable().default(null), request: requestSchema }),
  z.object({ action: z.literal('update_request'), requestId: z.string().min(1), patch: requestPatchSchema }),
  z.object({ action: z.literal('rename_folder'), folderId: z.string().min(1), name: z.string().trim().min(1).max(160) }),
  z.object({ action: z.literal('move_node'), nodeId: z.string().min(1), parentId: z.string().nullable().default(null), index: z.number().int().min(0).optional() }),
  z.object({ action: z.literal('deprecate_request'), requestId: z.string().min(1), deprecated: z.boolean().default(true), reason: z.string().max(4096).optional() }),
  z.object({ action: z.literal('delete_node'), nodeId: z.string().min(1) }),
])

export const variableNameSchema = z.string().trim().min(1).max(160)
export const variableValueSchema = z.string().max(65536)
