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

describe('band above the prompt', () => {
  test('keeps what the plugins beneath draw, next to the Cut button', async ($, on) => {
    composer(on, [])
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) =>
      h($.ui.resolve(e).Text, {}, 'beneath') as never,
    )
    await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: 'a' },
      text: '',
      cursor: 0,
      start: 0,
      end: 0,
      inputText: 'hello',
    } as never)

    const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never
    const band = await $.ui.mount({ plugin: 'cut-input', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await band.find({ key: 'cut' })).toBeDefined()
    expect(await band.find({ text: /beneath/ })).toBeDefined()
  })
})

describe('cut-input', () => {
  test('Ctrl+Shift+U cuts the whole draft regardless of cursor', async ($, on) => {
    const copied: string[] = []
    composer(on, copied)
    const result = await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: 'u', ctrl: true, shift: true },
      text: 'line one\nline two\nline three',
      cursor: 9,
      start: 9,
      end: 9,
      inputText: '',
    } as never)
    expect(copied).toEqual(['line one\nline two\nline three'])
    expect(result).toEqual({ text: '', cursor: 0 })
  })

  test('Ctrl+U without Shift does not cut the whole draft', async ($, on) => {
    const copied: string[] = []
    composer(on, copied)
    await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: 'u', ctrl: true },
      text: 'line one\nline two\nline three',
      cursor: 9,
      start: 9,
      end: 9,
      inputText: '',
    } as never)
    expect(copied).toEqual([])
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
