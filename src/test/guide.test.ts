import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { allCommands } from '../commands/index.js'
import { createGuideGate, guideText } from '../guide.js'
import { mcpCommands } from '../mcp-surface.js'

// Tools an MCP client can call: every exposed command (dots become underscores), plus the guide and list_commands tools.
const exposedTools = new Set([...mcpCommands().map((command) => command.id.replace(/\./g, '_')), 'guide', 'list_commands'])
// The operations a change accepts, set inside changes_preview. MCP clients have no direct folder or request write tools.
const changeOperations = ['create_folder', 'rename_folder', 'move_node', 'delete_node', 'create_request', 'update_request', 'deprecate_request']

// Common Indonesian words. The guide, tool titles, and descriptions are read by agents and must be English.
const indonesianWords = /\b(yang|dan|untuk|tidak|dengan|atau|buat|hapus|ubah|kirim|pakai|harus|bisa|sudah|akan|dari)\b/i

describe('guide gate', () => {
  it('lets read-only commands run before the guide is read', () => {
    assert.equal(createGuideGate().refusal({ readOnly: true }), null)
  })

  it('refuses a write until the guide has been read', () => {
    const gate = createGuideGate()
    assert.match(gate.refusal({ readOnly: false }) ?? '', /Read the guide first/)
  })

  it('lets writes run once the guide has been read', () => {
    const gate = createGuideGate()
    gate.markRead()
    assert.equal(gate.refusal({ readOnly: false }), null)
  })

  it('keeps each gate separate, so one session does not unlock another', () => {
    const first = createGuideGate()
    first.markRead()
    assert.match(createGuideGate().refusal({ readOnly: false }) ?? '', /Read the guide first/)
  })
})

describe('guide text', () => {
  it('names the rules that protect data: preview before apply, confirm for deletes, and no secrets', () => {
    assert.match(guideText, /changes_preview/)
    assert.match(guideText, /Do not call changes_apply in the same turn/)
    assert.match(guideText, /confirm=true/)
    assert.match(guideText, /Never write a real token, password, or key/)
  })

  it('covers auth, variables, docs per flow, and folders by service', () => {
    assert.match(guideText, /token \{\{accessToken\}\}/)
    assert.match(guideText, /Use secret true/)
    assert.match(guideText, /Step 2 of Checkout/)
    assert.match(guideText, /Top level: one folder per service/)
  })

  it('is written in English, and so are the command titles and descriptions', () => {
    assert.doesNotMatch(guideText, indonesianWords)
    for (const command of allCommands) {
      assert.doesNotMatch(`${command.title} ${command.description}`, indonesianWords, command.id)
    }
  })

  it('names only tools an MCP client can call, and real change operations', () => {
    const names = new Set(guideText.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])
    for (const name of names) {
      assert.ok(exposedTools.has(name) || changeOperations.includes(name), `the guide names ${name}, which MCP clients cannot call`)
    }
  })

  it('lists change operations that the schema accepts', () => {
    const schema = readFileSync('src/schemas.ts', 'utf8')
    for (const operation of changeOperations) assert.match(schema, new RegExp(`'${operation}'`), operation)
  })

  it('uses the tool names the server exposes, not the dotted command ids', () => {
    assert.doesNotMatch(guideText, /changes\.preview|tree\.get|request\.get/)
  })
})
