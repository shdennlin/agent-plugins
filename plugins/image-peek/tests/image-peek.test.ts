import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/private/tmp/claude-501/proj/sess-1/images'
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 16, bodyColumns: 140 } as never

// The engine beneath the plugin: a session whose box holds `draft`, with every image file in place.
function world(on: On, draft: { text: string }) {
  on('session.id', async () => ({ value: 'sess-1' }))
  on('prompt.read', async () => ({ value: { text: draft.text, cursor: draft.text.length } }) as never)
  on('fs.list', async () => ({ value: [{ name: 'proj', kind: 'directory', size: 0, mtimeMs: 0, isLink: false }] }) as never)
  on('fs.exists', async () => ({ value: true }))
  on('process.run', async (_$, e) => {
    const out = e.argv[0] === 'id' ? '501\n' : 'pixelWidth: 1200\npixelHeight: 600\n'
    return { value: { exitCode: 0, stdout: out, stderr: '' } } as never
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}) as never)
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
}

describe('band above the prompt', () => {
  test('draws a thumbnail and a magnifier for each [Image #N] in the box', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    world(on, { text: '[Image #3] look [Image #4]' })
    await start($)
    await clock.advance(400)

    const band = await $.ui.mount({ plugin: 'image-peek', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect((await band.find({ key: 'open-3' }))?.text).toMatch(/#3/)
    expect((await band.find({ key: 'open-4' }))?.text).toMatch(/#4/)
    expect(await band.find({ key: 'img-3' })).toBeDefined()
  })

  test('draws nothing while the box holds no image tag', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    world(on, { text: 'just words' })
    await start($)
    await clock.advance(400)

    const band = await $.ui.mount({ plugin: 'image-peek', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ key: 'open-3' })).toBeUndefined()
  })

  test('yields to a survey', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    world(on, { text: '[Image #1]' })
    await start($)
    await clock.advance(400)

    const props = { hasSurvey: true, isWorking: false, maxRows: 16, bodyColumns: 140 } as never
    const band = await $.ui.mount({ plugin: 'image-peek', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await band.find({ key: 'open-1' })).toBeUndefined()
  })
})
