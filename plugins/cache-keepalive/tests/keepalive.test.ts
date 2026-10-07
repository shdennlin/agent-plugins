import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 4, 14, 27) // 22:27 in UTC+8
const TTL_1H_ROW = JSON.stringify({
  type: 'assistant',
  message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 9000, ephemeral_5m_input_tokens: 0 } } },
})
const TTL_5M_ROW = JSON.stringify({
  type: 'assistant',
  message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9000 } } },
})

type World = {
  forks: number
  files: Map<string, string>
  toasts: string[]
  forkCacheRead: number
  clock: ReturnType<typeof mock.clock>
}

// The engine beneath the plugin: a session with a 1h-TTL transcript and a
// 180k context, whose forks hit the cache unless the test says otherwise.
function world(on: On, opts: { context?: number; ttlRow?: string } = {}): World {
  const w: World = {
    forks: 0,
    files: new Map(),
    toasts: [],
    forkCacheRead: 179_000,
    clock: mock.clock(on, { now: T0 }),
  }
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({ value: { context: { tokens: opts.context ?? 180_000, window: 1_000_000 } } }) as never)
  on('process.run', async ($, e) =>
    e.argv[0] === 'tail'
      ? ({ value: { exitCode: 0, stdout: `cut row\n${opts.ttlRow ?? TTL_1H_ROW}\n`, stderr: '' } } as never)
      : ({ value: { exitCode: 0, stdout: '', stderr: '' } } as never),
  )
  on('fs.write', async ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', async () => ({ value: [] }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }) as never)
  on('ui.toast', async ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', async () => {
    w.forks += 1
    return {
      value: {
        isAnswered: true,
        text: 'ok',
        usage: { input_tokens: 40, output_tokens: 4, cache_read_input_tokens: w.forkCacheRead, cache_creation_input_tokens: 0 },
      },
    } as never
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  // The engine's own band above the prompt is empty.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}) as never)
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: 'done' }))
  return w
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
}

async function turn($: Engine, opts: { agentId?: string } = {}) {
  await $.turn.start({ text: 'hi', turnId: 't' })
  await $.turn.complete({
    reason: 'answer',
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't',
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  } as never)
}

function stateOf(w: World): Record<string, unknown> {
  const text = w.files.get('/home/u/.claude/keepalive/sess-1.json')
  return text ? JSON.parse(text) : {}
}

describe('scheduling', () => {
  test('pings once at TTL minus 5 min, then caps at 2 and expires (AC1, AC4)', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', ttlSec: 3600, pings: 0, max: 2 })

    await w.clock.advance(54 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(w.forks).toBe(1)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 1, lastPingAt: T0 + 55 * MIN })

    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(2)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 2 })

    await w.clock.advance(4 * 60 * MIN)
    expect(w.forks).toBe(2)
    expect(stateOf(w)).toMatchObject({ phase: 'expired' })
  })

  test('a new turn cancels the scheduled ping (AC5)', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    await w.clock.advance(30 * MIN)
    await $.turn.start({ text: 'back', turnId: 't2' })
    expect(stateOf(w)).toMatchObject({ phase: 'active', pings: 0 })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
  })

  test('/keepalive done cancels the scheduled ping (AC5)', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    const r = await $.command.run({ command: 'keepalive', args: 'done' } as never)
    expect(r).toMatchObject({ text: 'Keepalive stopped until your next prompt.' })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'stopped' })
  })

  test('a subagent turn neither arms nor cancels (AC6)', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 's', agentId: 'a1' } as never)
    expect(stateOf(w).phase).toBeUndefined()

    await turn($)
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 's', agentId: 'a1' } as never)
    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a small context is not kept warm (AC7)', async ($, on) => {
    const w = world(on, { context: 20_000 })
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'small' })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
  })

  test('a 5m TTL turns keepalive off (AC12)', async ($, on) => {
    const w = world(on, { ttlRow: TTL_5M_ROW })
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'off', offReason: '5m-ttl', ttlSec: 300 })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
  })

  test('/keepalive brb 180 raises the cap to 4 for this idle stretch only', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'brb 180' } as never)
    expect(stateOf(w)).toMatchObject({ max: 4 })
    await w.clock.advance(4 * 55 * MIN)
    expect(w.forks).toBe(4)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 4 })
    await turn($)
    expect(stateOf(w)).toMatchObject({ max: 2, pings: 0 })
  })

  test('a reload re-arms from $.state (AC9, approximated by a second session.start)', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    await w.clock.advance(20 * MIN)
    await start($)
    await w.clock.advance(35 * MIN)
    expect(w.forks).toBeGreaterThanOrEqual(1)
  })
})

describe('verification', () => {
  test('a miss turns keepalive off with one toast (AC8)', async ($, on) => {
    const w = world(on)
    w.forkCacheRead = 0
    await start($)
    await turn($)
    await w.clock.advance(55 * MIN)
    expect(stateOf(w)).toMatchObject({ phase: 'off', offReason: 'ttl-mismatch' })
    expect(w.toasts).toHaveLength(1)

    await turn($)
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(1)
    expect(w.toasts).toHaveLength(1)
  })
})

describe('expired band (AC13)', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows once on ${surface}, dismisses, and clears on the next turn`, async ($, on) => {
      const w = world(on)
      await start($)
      await turn($)
      const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never
      const band = await $.ui.mount({ plugin: 'cache-keepalive', surface, component: 'AbovePrompt', props })
      expect(await band.find({ text: /Cache expired/ })).toBeUndefined()

      await w.clock.advance(3 * 60 * MIN)
      expect((await band.find({ text: /Cache expired/ }))?.text).toMatch(/rewrites ~180k/)

      await band.press({ key: 'dismiss' })
      expect(await band.find({ text: /Cache expired/ })).toBeUndefined()

      await w.clock.advance(5 * 60 * MIN)
      await turn($)
      expect(await band.find({ text: /Cache expired/ })).toBeUndefined()
    })
  }
})

describe('/keepalive brb completion', () => {
  // The editor beneath the plugin: applies the splice to the draft it is given.
  function editor(on: On) {
    on('prompt.edit', async ($, e) => ({
      text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
      cursor: e.start + e.inputText.length,
    }))
  }
  // One keystroke: the box as the plugin last answered it, plus the key.
  async function type($: Engine, box: { text: string; cursor: number }, input: string, key = input) {
    const at = box.cursor
    const isBackspace = input === '\b'
    // The kit's Engine type does not list prompt.edit, though the call runs.
    const prompt = $.prompt as unknown as { edit: (e: unknown) => Promise<{ text: string; cursor: number }> }
    return prompt.edit({
      origin: { kind: 'person' },
      key: { key: isBackspace ? 'backspace' : key },
      text: box.text,
      cursor: box.cursor,
      start: isBackspace ? at - 1 : at,
      end: at,
      inputText: isBackspace ? '' : input,
    } as never)
  }

  test('offers 180, completes typed digits, and Right accepts', async ($, on) => {
    world(on)
    editor(on)
    let box = { text: '/keepalive brb', cursor: 14 }
    box = await type($, box, ' ', 'space')
    expect(box).toMatchObject({ text: '/keepalive brb 180', cursor: 15 })
    expect((box as { decorations?: unknown[] }).decorations).toEqual([{ start: 15, end: 18, dimColor: true }])

    box = await type($, box, '4')
    expect(box).toMatchObject({ text: '/keepalive brb 480', cursor: 16 })

    box = await type($, box, '\b')
    box = await type($, box, '6')
    expect(box).toMatchObject({ text: '/keepalive brb 60', cursor: 16 })

    box = await type($, box, '', 'right')
    expect(box).toEqual({ text: '/keepalive brb 60', cursor: 17 })

    box = await type($, box, '5')
    expect(box).toMatchObject({ text: '/keepalive brb 605', cursor: 18 })
  })

  test('leaves other drafts alone', async ($, on) => {
    world(on)
    editor(on)
    const box = await type($, { text: '/keepalive done', cursor: 15 }, ' ', 'space')
    expect(box).toEqual({ text: '/keepalive done ', cursor: 16 })
  })
})

describe('engineStatus', () => {
  function statuses(on: On): (string | undefined)[] {
    const seen: (string | undefined)[] = []
    on('ui.status', async ($, e) => {
      seen.push(e.text)
      return { value: undefined }
    })
    return seen
  }

  test('is off by default: no status entry at all (AC10)', async ($, on) => {
    const w = world(on)
    const seen = statuses(on)
    await start($)
    await turn($)
    await w.clock.advance(3 * 60 * MIN)
    expect(seen).toEqual([])
  })

  test('when on, follows the phase with clock times and clears while working', { options: { engineStatus: true } }, async ($, on) => {
    const w = world(on)
    const seen = statuses(on)
    await start($)
    await turn($)
    expect(seen.at(-1)).toMatch(/^keep 0\/2 · ping \d\d:\d\d$/)
    await w.clock.advance(55 * MIN)
    expect(seen.at(-1)).toMatch(/^keep 1\/2 · ping /)
    await w.clock.advance(55 * MIN)
    expect(seen.at(-1)).toMatch(/^keep 2\/2 ⏸ · expires /)
    await w.clock.advance(60 * MIN)
    expect(seen.at(-1)).toBe('cache expired')
    await $.turn.start({ text: 'back', turnId: 't3' })
    expect(seen.at(-1)).toBeUndefined()
  })
})

describe('telegram', () => {
  const TG = { telegramBotToken: 'T0K', telegramChatId: '-4945195984', telegramUserId: '7' }

  // A fake Bot API: records calls, answers getUpdates from a queue.
  function botApi(on: On) {
    const calls: { method: string; body: Record<string, unknown> }[] = []
    const pending: unknown[] = []
    let nextId = 900
    on('http.fetch', async ($, e) => {
      const method = e.url.split('/').pop() ?? ''
      const body = JSON.parse(e.init?.body ?? '{}')
      calls.push({ method, body })
      // Every sent message gets a new id, as on Telegram; the first is 901.
      const result = method === 'sendMessage' ? { message_id: (nextId += 1) } : method === 'getUpdates' ? pending : true
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, result }) } } as never
    })
    const press = (data: string, from = 7) =>
      pending.push({
        update_id: pending.length + 1,
        callback_query: { id: `cb${pending.length}`, data, from: { id: from }, message: { message_id: 901, chat: { id: -4945195984 } } },
      })
    const reply = (text: string, from = 7) =>
      pending.push({
        update_id: pending.length + 1,
        message: { text, from: { id: from }, chat: { id: -4945195984 }, reply_to_message: { message_id: 901 } },
      })
    return { calls, press, reply, methods: () => calls.map(c => c.method).filter(m => m !== 'getUpdates') }
  }

  async function capped($: Engine, w: World) {
    await start($)
    await turn($)
    await w.clock.advance(110 * MIN)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 2 })
  }

  test('asks once the pings run out, and +1h keeps it warm', { options: TG }, async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    const ask = bot.calls.find(c => c.method === 'sendMessage')
    expect(ask?.body).toMatchObject({ chat_id: '-4945195984', parse_mode: 'HTML' })
    expect(JSON.stringify(ask?.body.reply_markup)).toContain('ka:sess-1:60')

    bot.press('ka:sess-1:60')
    await w.clock.advance(10_000)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3 })
    expect(bot.methods()).toEqual(['sendMessage', 'answerCallbackQuery', 'editMessageText'])

    await w.clock.advance(60 * MIN)
    expect(w.forks).toBe(3)
  })

  test('asks again once the extra pings run out', { options: TG }, async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    bot.press('ka:sess-1:60')
    await w.clock.advance(10_000)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3 })

    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(3)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 3 })
    expect(bot.calls.filter(c => c.method === 'sendMessage')).toHaveLength(2)
  })

  test('a text reply sets the minutes', { options: TG }, async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    bot.reply('2h')
    await w.clock.advance(10_000)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 2 + 2 })
  })

  test('"let it expire" stops, and presses from others or other sessions are ignored', { options: TG }, async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    bot.press('ka:sess-1:60', 99)
    bot.press('ka:other-se:60')
    await w.clock.advance(10_000)
    expect(stateOf(w)).toMatchObject({ phase: 'capped' })

    bot.press('ka:sess-1:0')
    await w.clock.advance(10_000)
    expect(stateOf(w)).toMatchObject({ phase: 'stopped' })
    const edit = bot.calls.find(c => c.method === 'editMessageText')
    expect(String(edit?.body.text)).toContain('Letting it expire')
  })

  test('coming back closes the question and stops polling', { options: TG }, async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    await $.turn.start({ text: 'back', turnId: 'tb' })
    expect(bot.methods()).toEqual(['sendMessage', 'editMessageText'])
    const polls = bot.calls.filter(c => c.method === 'getUpdates').length
    await w.clock.advance(5 * MIN)
    expect(bot.calls.filter(c => c.method === 'getUpdates').length).toBe(polls)
  })

  test('without a token nothing is sent', async ($, on) => {
    const w = world(on)
    const bot = botApi(on)
    await capped($, w)
    await w.clock.advance(60 * MIN)
    expect(bot.calls).toEqual([])
  })
})

describe('compact before expiry', () => {
  const SUMMARY = { role: 'user', text: 'summary', toolUses: [] }
  // The engine's own compaction: counts calls, shrinks the context to 14k.
  function compacting(on: On, w: World): { calls: number } {
    const c = { calls: 0 }
    on('session.compact', async () => {
      c.calls += 1
      return { messages: [SUMMARY], tokensBefore: 180_000, tokensAfter: 14_000 } as never
    })
    return c
  }
  const ON = { compactBeforeExpiry: true, maxPings: 0 }

  test('is off by default: a capped idle stretch just expires', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await $.command.run({ command: 'keepalive', args: 'brb 1' } as never)
    await turn($)
    await w.clock.advance(2 * 60 * MIN)
    expect(c.calls).toBe(0)
  })

  test('compacts at TTL minus lead once the pings are used up', { options: ON }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'capped' })
    await w.clock.advance(49 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'active', contextTokens: 14_000 })
    expect(w.toasts.at(-1)).toContain('Compacted before the cache expired')
    await w.clock.advance(2 * 60 * MIN)
    expect(c.calls).toBe(1)
  })

  test('waits for the last ping, then compacts in the next lead window', { options: { compactBeforeExpiry: true, maxPings: 1 } }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(1)
    expect(c.calls).toBe(0)
    await w.clock.advance(49 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
  })

  test('a new turn cancels the scheduled compact', { options: ON }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await w.clock.advance(30 * MIN)
    await $.turn.start({ text: 'back', turnId: 't2' })
    await w.clock.advance(2 * 60 * MIN)
    expect(c.calls).toBe(0)
  })

  test('/keepalive compact arms a one-time compact that survives goal turns', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    const r = (await $.command.run({ command: 'keepalive', args: 'compact' } as never)) as { text: string }
    expect(r.text).toContain('Armed')
    // A /goal's continuations are turns of their own: the arming must outlast them.
    await turn($)
    await turn($)
    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(1)
    expect(c.calls).toBe(0)
    await w.clock.advance(55 * MIN)
    expect(w.forks).toBe(2)
    expect(c.calls).toBe(0)
    await w.clock.advance(50 * MIN)
    expect(c.calls).toBe(1)
    expect(stateOf(w)).toMatchObject({ phase: 'active' })
    // One time: the next idle stretch is not compacted.
    await turn($)
    await w.clock.advance(3 * 60 * MIN)
    expect(c.calls).toBe(1)
  })

  test('/keepalive compact off disarms it', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'compact' } as never)
    const r = (await $.command.run({ command: 'keepalive', args: 'compact off' } as never)) as { text: string }
    expect(r.text).toContain('disarmed')
    await w.clock.advance(3 * 60 * MIN)
    expect(c.calls).toBe(0)
  })

  test('/keepalive status shows the armed compact time', async ($, on) => {
    const w = world(on)
    compacting(on, w)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'compact' } as never)
    const r = (await $.command.run({ command: 'keepalive', args: 'status' } as never)) as { text: string }
    expect(r.text).toContain('compact before expiry: armed')
  })

  test('/keepalive done + compact: no pings, compacts in the first lead window', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'done' } as never)
    const r = (await $.command.run({ command: 'keepalive', args: 'compact' } as never)) as { text: string }
    expect(r.text).toContain('no pings')
    expect(stateOf(w)).toMatchObject({ phase: 'stopped' })
    await w.clock.advance(49 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
    expect(w.forks).toBe(0)
  })

  test('compact then done keeps the armed compact scheduled', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'compact' } as never)
    const r = (await $.command.run({ command: 'keepalive', args: 'done' } as never)) as { text: string }
    expect(r.text).toContain('armed compact still runs')
    await w.clock.advance(55 * MIN)
    expect(c.calls).toBe(1)
    expect(w.forks).toBe(0)
  })

  test('the reply names the real time: pings first, then compact', async ($, on) => {
    const w = world(on)
    compacting(on, w)
    await start($)
    await turn($)
    const r = (await $.command.run({ command: 'keepalive', args: 'compact' } as never)) as { text: string }
    // 2 pings at +55 and +110, compact 50 min before the cache expires. Local time varies, so only the shape.
    expect(r.text).toMatch(/compact at about \d\d:\d\d \(after the remaining pings\)/)
  })

  // A /goal can end on an API error while you sleep: the armed compact must still run.
  for (const reason of ['error', 'refusal'] as const) {
    test(`an armed compact still runs when the last turn ends in ${reason}`, async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await $.command.run({ command: 'keepalive', args: 'compact' } as never)
      await $.turn.start({ text: 'goal', turnId: 't2' })
      await $.turn.complete({ reason, answer: '', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
      expect(stateOf(w)).toMatchObject({ phase: 'capped', compactArmed: true })
      expect(w.forks).toBe(0)
      await w.clock.advance(49 * MIN)
      expect(c.calls).toBe(0)
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
    })
  }

  test('an error turn without an armed compact still goes back to active', async ($, on) => {
    const w = world(on)
    compacting(on, w)
    await start($)
    await turn($)
    await $.turn.start({ text: 'x', turnId: 't2' })
    await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
    expect(stateOf(w)).toMatchObject({ phase: 'active' })
  })

  test('the state file carries the armed flag and the due time for the status line', async ($, on) => {
    const w = world(on)
    compacting(on, w)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ compactArmed: false, compactAt: null })
    await $.command.run({ command: 'keepalive', args: 'compact' } as never)
    // 2 pings (+55, +110), then compact 10 min before that cache expires: +110 + 50 = +160 min.
    expect(stateOf(w)).toMatchObject({ compactArmed: true, compactAt: T0 + 160 * MIN })
    await $.command.run({ command: 'keepalive', args: 'compact off' } as never)
    expect(stateOf(w)).toMatchObject({ compactArmed: false, compactAt: null })
  })

  test('compactLeadMinutes moves the compact, and leaves the ping lead alone', { options: { compactBeforeExpiry: true, maxPings: 0, compactLeadMinutes: 20 } }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await w.clock.advance(39 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
  })

  // brb raises the ping cap, compact only adds the last step: the order must not matter.
  for (const order of [['brb 180', 'compact'], ['compact', 'brb 180']] as const) {
    test(`/keepalive ${order[0]} then ${order[1]}: 4 pings, then one compact`, async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      for (const args of order) await $.command.run({ command: 'keepalive', args } as never)
      // pings at +55, +110, +165, +220, compact 10 min before that cache expires: +270
      expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 4, compactArmed: true, compactAt: T0 + 270 * MIN })
      await w.clock.advance(220 * MIN)
      expect(w.forks).toBe(4)
      expect(c.calls).toBe(0)
      expect(stateOf(w)).toMatchObject({ phase: 'capped' })
      await w.clock.advance(49 * MIN)
      expect(c.calls).toBe(0)
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
      expect(w.forks).toBe(4)
    })
  }
})
