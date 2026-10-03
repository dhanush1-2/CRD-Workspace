import { describe, it, expect } from 'vitest'
import { ROVING_ITEM } from '../src/components/useRovingToolRow.js'
import { ToolButton } from '../src/components/ToolButton.js'

// ToolButton is a plain function component with no hooks, so it can be called and the
// element it returns inspected, without a DOM or a renderer.
const attributes = (props: Parameters<typeof ToolButton>[0]) =>
  (ToolButton(props) as { props: Record<string, unknown> }).props

describe('ToolButton and the roving tool row', () => {
  it('joins the row by default', () => {
    expect(attributes({ label: 'Bold' })).toMatchObject(ROVING_ITEM)
  })

  it('stays out of the row when roving is false, as a button inside a menu must', () => {
    // Rendered inside the row's DOM, a button carrying data-roving is collected into the
    // row's roving set, which is how a menu's items would become stops of the toolbar.
    expect(attributes({ label: 'Add', roving: false })).not.toHaveProperty('data-roving')
  })
})
