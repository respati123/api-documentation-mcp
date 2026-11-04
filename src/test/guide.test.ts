import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createGuideGate, guideText } from '../guide.js'

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
    assert.match(guideText, /Never write a real secret/)
  })

  it('uses the tool names the server exposes, not the dotted command ids', () => {
    assert.doesNotMatch(guideText, /changes\.preview|tree\.get|request\.get/)
  })
})
