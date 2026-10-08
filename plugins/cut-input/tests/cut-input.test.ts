import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine beneath the plugin: the composer applies the edit and answers with the box.
function composer(on: On, copied: string[]) {
  on('prompt.edit', async (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
}

describe('cut-input', () => {
  test('Ctrl+U copies the text it kills', async ($, on) => {
    const copied: string[] = []
    composer(on, copied)
    await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: 'u', ctrl: true },
      text: 'hello world',
      cursor: 11,
      start: 0,
      end: 11,
      inputText: '',
    } as never)
    expect(copied).toEqual(['hello world'])
  })

  test('a plain keystroke copies nothing', async ($, on) => {
    const copied: string[] = []
    composer(on, copied)
    await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: 'a' },
      text: 'hell',
      cursor: 4,
      start: 4,
      end: 4,
      inputText: 'o',
    } as never)
    expect(copied).toEqual([])
  })
})
