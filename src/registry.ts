import { z } from 'zod'

// One registry of commands. The CLI (`commands`, `run`), the MCP server, and the app's documentation all read it.
export type Command = {
  id: string
  group: string
  title: string
  description: string
  params: z.AnyZodObject
  readOnly: boolean
  destructive: boolean
  run: (rawInput: unknown) => unknown | Promise<unknown>
}

// Turns zod issues into one readable line per field, so the agent or user sees what to fix.
function parseInput<S extends z.AnyZodObject>(schema: S, rawInput: unknown): z.infer<S> {
  const result = schema.safeParse(rawInput ?? {})
  if (result.success) return result.data
  const lines = result.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
  throw new Error(`Invalid parameters: ${lines.join('; ')}`)
}

export function defineCommand<S extends z.AnyZodObject>(definition: {
  id: string
  group: string
  title: string
  description: string
  params: S
  readOnly: boolean
  destructive?: boolean
  run: (input: z.infer<S>) => unknown | Promise<unknown>
}): Command {
  return {
    id: definition.id,
    group: definition.group,
    title: definition.title,
    description: definition.description,
    params: definition.params,
    readOnly: definition.readOnly,
    destructive: definition.destructive === true,
    run: (rawInput) => definition.run(parseInput(definition.params, rawInput)),
  }
}

export type ParamInfo = { name: string; type: string; required: boolean; description?: string }

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema
  for (let depth = 0; depth < 10; depth += 1) {
    const def = current._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny }
    if (def.innerType) current = def.innerType
    else if (def.schema) current = def.schema
    else break
  }
  return current
}

function typeName(schema: z.ZodTypeAny): string {
  const inner = unwrap(schema)
  const kind = (inner._def as { typeName?: string }).typeName ?? 'unknown'
  return kind.replace(/^Zod/, '').toLowerCase()
}

export function describeParams(schema: z.AnyZodObject): ParamInfo[] {
  return Object.entries(schema.shape).map(([name, field]) => {
    const field_ = field as z.ZodTypeAny
    return {
      name,
      type: typeName(field_),
      required: !field_.isOptional(),
      ...(field_.description ? { description: field_.description } : {}),
    }
  })
}

export function describeCommand(command: Command) {
  return {
    id: command.id,
    group: command.group,
    title: command.title,
    description: command.description,
    readOnly: command.readOnly,
    destructive: command.destructive,
    params: describeParams(command.params),
  }
}
