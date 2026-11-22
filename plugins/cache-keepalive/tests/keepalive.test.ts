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
// A 1h-TTL row carrying its real write time, as a resumed session'''s transcript would.
const ttl1hRowAt = (atMs: number) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 9000, ephemeral_5m_input_tokens: 0 } } },
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
  test('pings once at TTL minus 10 min, then caps at 2 and expires', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', ttlSec: 3600, pings: 0, max: 2 })

    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(w.forks).toBe(1)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 1, lastPingAt: T0 + 50 * MIN })

    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(2)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 2 })

    await w.clock.advance(4 * 60 * MIN)
    expect(w.forks).toBe(2)
    expect(stateOf(w)).toMatchObject({ phase: 'expired' })
  })

  test('a new turn cancels the scheduled ping', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    await w.clock.advance(30 * MIN)
    await $.turn.start({ text: 'back', turnId: 't2' })
    expect(stateOf(w)).toMatchObject({ phase: 'active', pings: 0 })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
  })

  test('/keepalive done was removed: it says so and the pings go on', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    const r = (await $.command.run({ command: 'keepalive', args: 'done' } as never)) as { text: string }
    expect(r.text).toContain('removed in 0.8.0')
    expect(stateOf(w)).toMatchObject({ phase: 'armed' })
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a subagent turn neither arms nor cancels', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 's', agentId: 'a1' } as never)
    expect(stateOf(w).phase).toBeUndefined()

    await turn($)
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 's', agentId: 'a1' } as never)
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a small context is not kept warm', async ($, on) => {
    const w = world(on, { context: 20_000 })
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'small' })
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
  })

  test('a 5m TTL turns keepalive off', async ($, on) => {
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
    await w.clock.advance(4 * 50 * MIN)
    expect(w.forks).toBe(4)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 4 })
    await turn($)
    expect(stateOf(w)).toMatchObject({ max: 2, pings: 0 })
  })

  test('a reload re-arms from $.state (approximated by a second session.start)', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    await w.clock.advance(20 * MIN)
    await start($)
    await w.clock.advance(35 * MIN)
    expect(w.forks).toBeGreaterThanOrEqual(1)
  })

  test('/keepalive ping fires immediately, restarts the countdown, and does not use up the cap', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($)
    expect(w.forks).toBe(0)
    await w.clock.advance(10 * MIN)
    const r = (await $.command.run({ command: 'keepalive', args: 'ping' } as never)) as { text: string }
    expect(w.forks).toBe(1)
    expect(r.text).toBe('Pinged manually: phase armed, 0/2 automatic pings used.')
    // the countdown restarts from the manual ping, the cap stays untouched
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 0, lastPingAt: T0 + 10 * MIN })

    // the original +50 timer must have been cancelled by the manual ping's
    // own rearm; the next automatic ping is 50 min after the manual one.
    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(1)
    await w.clock.advance(1 * MIN)
    expect(w.forks).toBe(2)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 1 })

    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(3)
    expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 2 })
  })

  test('/keepalive ping does nothing when not armed', async ($, on) => {
    const w = world(on, { context: 20_000 })
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'small' })
    const r = (await $.command.run({ command: 'keepalive', args: 'ping' } as never)) as { text: string }
    expect(r.text).toContain('phase is small')
    expect(w.forks).toBe(0)
  })
})

describe('resume', () => {
  test('session.start arms immediately from an existing transcript, using its real write time', async ($, on) => {
    const realLastActivity = T0 - 40 * MIN // the cache was really created 40 min ago (before this process started)
    const w = world(on, { ttlRow: ttl1hRowAt(realLastActivity) })
    await start($)
    // no turn in this process yet: everything below must come from the transcript alone
    expect(stateOf(w)).toMatchObject({ phase: 'armed', ttlSec: 3600, pings: 0 })

    // expiresAt = realLastActivity + 60 min = T0 + 20 min; next ping = expiresAt - 10 min lead = T0 + 10 min
    await w.clock.advance(9 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a transcript whose real TTL already ran out expires instead of arming with a fresh window', async ($, on) => {
    const longAgo = T0 - 90 * MIN // TTL is 60 min, so this cache is long gone
    const w = world(on, { ttlRow: ttl1hRowAt(longAgo) })
    await start($)
    await w.clock.advance(1) // let the already-due timers (scheduled at delay 0) run
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'expired' })
  })

  test('without a timestamp in the transcript row, session.start writes nothing and leaves it to the next turn', async ($, on) => {
    const w = world(on) // default TTL_1H_ROW carries no timestamp
    await start($)
    expect(stateOf(w)).toEqual({}) // no save happened: nothing to go on yet
    expect(w.forks).toBe(0)

    // a real turn still arms normally afterwards
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', ttlSec: 3600, pings: 0 })
  })
})

describe('verification', () => {
  test('a miss turns keepalive off with one toast', async ($, on) => {
    const w = world(on)
    w.forkCacheRead = 0
    await start($)
    await turn($)
    await w.clock.advance(50 * MIN)
    expect(stateOf(w)).toMatchObject({ phase: 'off', offReason: 'ttl-mismatch' })
    expect(w.toasts).toHaveLength(1)

    await turn($)
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(1)
    expect(w.toasts).toHaveLength(1)
  })
})

describe('expired band', () => {
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

  test('is off by default: no status entry at all', async ($, on) => {
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
    await w.clock.advance(50 * MIN)
    expect(seen.at(-1)).toMatch(/^keep 1\/2 · ping /)
    await w.clock.advance(50 * MIN)
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
    await w.clock.advance(100 * MIN)
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

    await w.clock.advance(50 * MIN)
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
  const ON = { compactBeforeExpiry: true }

  test('is off by default: a capped idle stretch just expires', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await $.command.run({ command: 'keepalive', args: 'brb 1' } as never)
    await turn($)
    await w.clock.advance(2 * 60 * MIN)
    expect(c.calls).toBe(0)
  })

  test('the compactBeforeExpiry option starts the session armed: N minutes after the last turn, every idle stretch', { options: ON }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true, compactAt: T0 + 50 * MIN })
    await w.clock.advance(49 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'active', contextTokens: 14_000, compactArmed: true })
    expect(w.toasts.at(-1)).toContain('Compacted before the cache expired')
    await turn($)
    await w.clock.advance(50 * MIN)
    expect(c.calls).toBe(2)
  })

  test('compact off turns the option off for the session', { options: ON }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    await $.command.run({ command: 'keepalive', args: 'compact off' } as never)
    await turn($)
    expect(stateOf(w)).toMatchObject({ compactArmed: false })
    await w.clock.advance(3 * 60 * MIN)
    expect(c.calls).toBe(0)
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

  test('/keepalive compact stays armed: survives goal turns and compacts again every idle stretch', async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    const r = (await $.command.run({ command: 'keepalive', args: 'compact' } as never)) as { text: string }
    expect(r.text).toContain('Armed')
    // A /goal's continuations are turns of their own: the arming must outlast them.
    await turn($)
    await turn($)
    await w.clock.advance(49 * MIN)
    expect(c.calls).toBe(0)
    await w.clock.advance(1 * MIN)
    expect(c.calls).toBe(1)
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'active', compactArmed: true })
    // Permanent: the next idle stretch compacts again, 50 min after its last turn.
    await turn($)
    await w.clock.advance(50 * MIN)
    expect(c.calls).toBe(2)
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
    expect(r.text).toContain('compact before expiry: armed (permanent until /keepalive compact off), timed 50 min')
  })

  test('compact pings and c p were removed: they say so and arm nothing', async ($, on) => {
    const w = world(on)
    compacting(on, w)
    await start($)
    await turn($)
    for (const args of ['compact pings', 'c p']) {
      const r = (await $.command.run({ command: 'keepalive', args } as never)) as { text: string }
      expect(r.text).toContain('removed in 0.8.0')
    }
    expect(stateOf(w)).toMatchObject({ compactArmed: false, phase: 'armed' })
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
    expect(stateOf(w)).toMatchObject({ compactArmed: true, compactAt: T0 + 50 * MIN })
    await $.command.run({ command: 'keepalive', args: 'compact off' } as never)
    expect(stateOf(w)).toMatchObject({ compactArmed: false, compactAt: null })
  })

  test('compactLeadMinutes sets how long N may be: 40 min with a 20 min lead, and the option\'s default 50 is dropped with a note', { options: { compactBeforeExpiry: true, compactLeadMinutes: 20 } }, async ($, on) => {
    const w = world(on)
    const c = compacting(on, w)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ compactArmed: false })
    expect(w.toasts.at(-1)).toContain('at most 40 min')
    const run = async (args: string) => ((await $.command.run({ command: 'keepalive', args } as never)) as { text: string }).text
    expect(await run('compact 41')).toContain('Too long')
    expect(await run('compact 40')).toContain('Armed')
    await w.clock.advance(40 * MIN)
    expect(c.calls).toBe(1)
  })

  // brb adds pings and moves the compact to its deadline; the order of the two must not matter.
  for (const order of [['brb 180', 'compact'], ['compact', 'brb 180']] as const) {
    test(`/keepalive ${order[0]} then ${order[1]}: pings keep it warm, one compact at the brb deadline`, async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      for (const args of order) await $.command.run({ command: 'keepalive', args } as never)
      // 3 pings (+50, +100, +150): a 4th would only follow the compact at +180
      expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3, compactArmed: true, compactAt: T0 + 180 * MIN })
      await w.clock.advance(179 * MIN)
      expect(w.forks).toBe(3) // pings at +50, +100, +150
      expect(c.calls).toBe(0)
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
      expect(w.forks).toBe(3)
    })
  }

  describe('timed compact: /keepalive compact [minutes], no pings', () => {
    const run = async ($: Engine, args: string) => ((await $.command.run({ command: 'keepalive', args } as never)) as { text: string }).text
    const submit = ($: Engine, prompt: string, source?: string) =>
      ($ as never as { classic: { UserPromptSubmit: (e: object) => Promise<unknown> } }).classic.UserPromptSubmit(source === undefined ? { prompt } : { prompt, source })

    test('bare compact: no pings, compacts 50 min after the last turn, warns about the loss', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      const text = await run($, 'compact')
      expect(text).toContain('no pings')
      expect(text).toContain('lossy')
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true, compactAt: T0 + 50 * MIN })
      await w.clock.advance(49 * MIN)
      expect(c.calls).toBe(0)
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
      expect(w.forks).toBe(0)
      expect(stateOf(w)).toMatchObject({ phase: 'active', compactArmed: true })
      expect(w.toasts.at(-1)).toContain('Compacted before the cache expired')
    })

    test('N persists: it fires again in the next idle stretch, and a bare compact keeps it', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact 45')
      await w.clock.advance(45 * MIN)
      expect(c.calls).toBe(1)
      expect(stateOf(w)).toMatchObject({ phase: 'active', compactArmed: true })
      await turn($) // you come back, work, and go idle again
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true })
      await run($, 'compact') // a bare compact does not reset N to the default
      expect(stateOf(w)).toMatchObject({ compactAt: T0 + 90 * MIN })
      await w.clock.advance(45 * MIN)
      expect(c.calls).toBe(2)
    })

    test('compact 45 counts from the last turn end, and survives later turns (each restarts the clock)', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact 45')
      await w.clock.advance(20 * MIN)
      await turn($) // a /goal continuation: the countdown restarts from here
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true, compactAt: T0 + 65 * MIN })
      await w.clock.advance(44 * MIN)
      expect(c.calls).toBe(0)
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
      expect(w.forks).toBe(0)
    })

    // The armed compact is the user's intent; brb only says how long they are away.
    // So brb must not turn a timed compact into the pings-first mode (where the compact
    // waits for every ping to be used up): pings keep the cache warm inside the window,
    // and the compact comes at its end, while the cache is still warm.
    test('brb after compact: pings keep it warm, the compact still fires at the brb deadline', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      await run($, 'brb 120')
      await w.clock.advance(119 * MIN)
      expect(c.calls).toBe(0)
      expect(w.forks).toBe(2) // two pings cover the first 120 minutes of a 1h cache
      await w.clock.advance(1 * MIN)
      expect(c.calls).toBe(1)
    })

    // Code review findings: with no pings running (an error turn) the cache cannot outlive
    // last turn + TTL, so a brb deadline past it must not push the compact past the expiry.
    test('an error turn during a brb keeps the compact inside the cache window', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      await run($, 'brb 180')
      await w.clock.advance(60 * MIN)
      await turn($) // an engine turn ends normally at +60: the cache now lasts to +120
      await $.turn.start({ text: 'x', turnId: 't2' })
      await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
      await w.clock.advance(61 * MIN) // +121
      expect(c.calls).toBe(1) // not the +240 brb deadline, which is past the expiry
    })

    // Pings are only worth it while the cache would otherwise expire before the compact:
    // a ping at the compact instant is a wasted full-context read.
    test('a brb that ends before the first ping is due needs no pings', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      expect(await run($, 'brb 20')).toContain('no pings')
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactAt: T0 + 50 * MIN })
      await w.clock.advance(50 * MIN)
      expect(c.calls).toBe(1)
      expect(w.forks).toBe(0)
    })

    test('a brb that ends on a ping boundary skips the ping that would only follow the compact', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      await run($, 'brb 100')
      expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 1, compactAt: T0 + 100 * MIN })
      await w.clock.advance(100 * MIN)
      expect(w.forks).toBe(1) // the ping at +50 only
      expect(c.calls).toBe(1)
    })

    test('no ping runs while a compaction is in flight', async ($, on) => {
      const w = world(on)
      let calls = 0
      let release: () => void = () => {}
      on('session.compact', async () => {
        calls += 1
        await new Promise<void>(resolve => (release = resolve))
        return { messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 180_000, tokensAfter: 14_000 } as never
      })
      await start($)
      await turn($)
      await run($, 'compact')
      await run($, 'brb 180')
      await w.clock.advance(180 * MIN) // pings at +50, +100, +150, then the compact starts and waits
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(calls).toBe(1)
      const forks = w.forks
      await run($, 'ping') // the phase is still armed while the summary is being made
      expect(w.forks).toBe(forks)
      release()
      for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(stateOf(w)).toMatchObject({ phase: 'active' }) // the compaction finished
    })

    describe('background tasks (the Stop hook\'s background_tasks)', () => {
      const stop = ($: Engine, tasks: object[]) =>
        ($ as never as { classic: { Stop: (e: object) => Promise<unknown> } }).classic.Stop({ background_tasks: tasks })
      const monitor = { id: 'm1', type: 'monitor', status: 'running', description: 'ticks', command: 'sleep 60' }
      async function armed($: Engine, on: On, args = 'compact') {
        const w = world(on)
        const c = compacting(on, w)
        on('classic.Stop', async () => ({}) as never)
        await start($)
        await turn($)
        if (args) await run($, args)
        return { w, c }
      }
      test('a running monitor is counted, warned about once, and the compact still fires at N', async ($, on) => {
        const { w, c } = await armed($, on)
        await stop($, [monitor])
        expect(stateOf(w)).toMatchObject({ bgTasks: 1 })
        expect(w.toasts.filter(t => t.includes('background task is still running'))).toHaveLength(1)
        await stop($, [monitor])
        expect(w.toasts.filter(t => t.includes('background task is still running'))).toHaveLength(1)
        await w.clock.advance(50 * MIN)
        expect(c.calls).toBe(1)
        expect(w.toasts.at(-1)).toContain('Still armed; /keepalive compact off to stop.')
      })
      test('the warning comes back after the compact, once more', async ($, on) => {
        const { w, c } = await armed($, on)
        await stop($, [monitor])
        await w.clock.advance(50 * MIN)
        expect(c.calls).toBe(1)
        await turn($)
        await stop($, [monitor])
        expect(w.toasts.filter(t => t.includes('background task is still running'))).toHaveLength(2)
      })
      test('only monitors and shells count: a subagent or workflow does not', async ($, on) => {
        const { w } = await armed($, on)
        await stop($, [{ id: 'a', type: 'subagent', status: 'running', description: 'x' }, { id: 'w', type: 'workflow', status: 'running', description: 'y' }])
        expect(stateOf(w)).toMatchObject({ bgTasks: 0 })
        expect(w.toasts).toEqual([])
      })
      test('no warning without an armed compact (the count is still recorded)', async ($, on) => {
        const a = await armed($, on, '')
        await stop($, [monitor])
        expect(stateOf(a.w)).toMatchObject({ bgTasks: 1 })
        expect(a.w.toasts).toEqual([])
      })
      test('no warning while a brb is running', async ($, on) => {
        const { w } = await armed($, on, 'compact')
        await run($, 'brb 120')
        await stop($, [monitor])
        expect(w.toasts.filter(t => t.includes('background task'))).toEqual([])
      })
      test('the tasks ending resets the count', async ($, on) => {
        const { w } = await armed($, on)
        await stop($, [monitor])
        await stop($, [])
        expect(stateOf(w)).toMatchObject({ bgTasks: 0 })
      })
      test('the state file and /keepalive status show it, the brb and that the compact is permanent', async ($, on) => {
        const { w } = await armed($, on, 'compact 45')
        await run($, 'brb 120')
        await stop($, [monitor])
        expect(stateOf(w)).toMatchObject({ compactAfterMin: 45, brbUntil: T0 + 120 * MIN, bgTasks: 1, compactArmed: true })
        const text = await run($, 'status')
        expect(text).toContain('compact before expiry: armed (permanent until /keepalive compact off), timed 45 min')
        expect(text).toMatch(/brb until \d\d:\d\d \(2h00m left\)/)
        expect(text).toContain('background: 1 task running (monitor or shell)')
      })
    })

    // brb records a deadline; each turn end derives the pings from it. So it can be typed
    // before the first turn ends (no TTL read yet) or while a turn (a /goal) is running.
    describe('brb before there is a cache to keep warm', () => {
      test('before the first turn ends: recorded, and the turn end derives the pings', async ($, on) => {
        const w = world(on)
        await start($)
        const text = await run($, 'brb 3h')
        expect(text).toContain('Noted')
        expect(text).not.toContain('Nothing to keep warm')
        expect(stateOf(w)).toMatchObject({ brbUntil: T0 + 180 * MIN })
        await turn($)
        expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 4, brbUntil: T0 + 180 * MIN })
        await w.clock.advance(150 * MIN)
        expect(w.forks).toBe(3) // +50, +100, +150
      })

      test('while a turn is running (a /goal): recorded, kept through the turn end', async ($, on) => {
        const w = world(on)
        await start($)
        await turn($)
        await $.turn.start({ text: 'goal', turnId: 't2' })
        const text = await run($, 'brb 2h')
        expect(text).toContain('Noted')
        expect(stateOf(w)).toMatchObject({ brbUntil: T0 + 120 * MIN })
        await $.turn.complete({ reason: 'stop', answer: 'x', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
        expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3, brbUntil: T0 + 120 * MIN })
      })

      test('with a compact armed, before the first turn: pings stop at the compact, at the brb deadline', async ($, on) => {
        const w = world(on)
        const c = compacting(on, w)
        await start($)
        await run($, 'compact')
        await run($, 'brb 3h')
        await turn($)
        expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3, compactArmed: true, compactAt: T0 + 180 * MIN })
        await w.clock.advance(180 * MIN)
        expect(w.forks).toBe(3)
        expect(c.calls).toBe(1)
      })

      test('brb reset before a turn ends clears the recorded deadline', async ($, on) => {
        const w = world(on)
        await start($)
        await run($, 'brb 3h')
        expect(await run($, 'brb reset')).toContain('ended')
        expect(stateOf(w)).toMatchObject({ brbUntil: null })
        await turn($)
        expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 2 })
      })
    })

    describe('a brb outlives the engine\'s own turns', () => {
      async function brbed($: Engine, on: On) {
        const w = world(on)
        const c = compacting(on, w)
        on('classic.UserPromptSubmit', async () => ({}) as never)
        await start($)
        await turn($)
        await run($, 'compact')
        await run($, 'brb 240')
        return { w, c }
      }
      test('a monitor event neither clears it nor moves the compact: it fires at the deadline', async ($, on) => {
        const { w, c } = await brbed($, on)
        await w.clock.advance(60 * MIN) // one ping at +50
        await submit($, '<task-notification>\n<task-id>x</task-id></task-notification>')
        await turn($) // the event's own turn
        // 180 min left, a ping every 50: 3 pings (+110, +160, +210) reach the deadline; the compact stays at +240.
        expect(stateOf(w)).toMatchObject({ phase: 'armed', max: 3, compactArmed: true, compactAt: T0 + 240 * MIN })
        await w.clock.advance(179 * MIN)
        expect(c.calls).toBe(0)
        await w.clock.advance(1 * MIN)
        expect(c.calls).toBe(1)
      })
      test('a prompt you typed ends it: back to N minutes after the last turn, no pings', async ($, on) => {
        const { w } = await brbed($, on)
        await submit($, 'I am back', 'user')
        await turn($)
        expect(stateOf(w)).toMatchObject({ phase: 'stopped', max: 2, compactAt: T0 + 50 * MIN })
      })
      test('a slash command does not end it', async ($, on) => {
        const { w } = await brbed($, on)
        await submit($, '/goal make three files', 'user')
        await turn($)
        expect(stateOf(w)).toMatchObject({ phase: 'armed', compactAt: T0 + 240 * MIN })
      })
    })

    test('"1h" is 60 minutes: too long for a 1h cache, refused', async ($, on) => {
      const w = world(on)
      compacting(on, w)
      await start($)
      await turn($)
      expect(await run($, 'compact 1h')).toContain('Too long')
      expect(await run($, 'compact 51')).toContain('Too long')
      expect(stateOf(w)).toMatchObject({ phase: 'armed', compactArmed: false })
    })

    test('nonsense minutes get the usage line', async ($, on) => {
      const w = world(on)
      compacting(on, w)
      await start($)
      await turn($)
      expect(await run($, 'compact soon')).toContain('Usage')
      expect(await run($, 'compact 0')).toContain('Usage')
    })

    test('c is an alias for compact', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      expect(await run($, 'c 20')).toContain('no pings')
      expect(stateOf(w)).toMatchObject({ compactArmed: true, compactAt: T0 + 20 * MIN })
      await w.clock.advance(20 * MIN)
      expect(c.calls).toBe(1)
      expect(await run($, 'C off')).toContain('disarmed')
    })

    test('s is an alias for status', async ($, on) => {
      world(on)
      await start($)
      await turn($)
      expect(await run($, 's')).toContain('phase:')
    })

    test('p is an alias for ping', async ($, on) => {
      const w = world(on)
      compacting(on, w)
      await start($)
      await turn($)
      expect(await run($, 'p')).toContain('Pinged manually')
      expect(w.forks).toBe(1)
    })

    test('compact off after a timed arm goes back to pinging', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      expect(stateOf(w)).toMatchObject({ phase: 'stopped' })
      await run($, 'compact off')
      expect(stateOf(w)).toMatchObject({ phase: 'armed', compactArmed: false })
      await w.clock.advance(31 * MIN)
      expect(c.calls).toBe(0)
      await w.clock.advance(19 * MIN)
      expect(w.forks).toBe(1)
    })

    test('arming while a turn runs schedules it when the turn ends', async ($, on) => {
      const w = world(on)
      const c = compacting(on, w)
      await start($)
      await $.turn.start({ text: 'goal', turnId: 't1' })
      expect(await run($, 'compact')).toContain('after the current turn ends')
      await $.turn.complete({ reason: 'stop', answer: 'x', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true })
      await w.clock.advance(50 * MIN)
      expect(c.calls).toBe(1)
    })

    test('a refused compaction leaves the compact armed and a note for /keepalive status', async ($, on) => {
      const w = world(on)
      on('session.compact', async () => ({ skip: 'context too large' }) as never)
      await start($)
      await turn($)
      await run($, 'compact')
      await w.clock.advance(50 * MIN)
      expect(stateOf(w)).toMatchObject({ compactArmed: true })
      expect(await run($, 'status')).toContain('last compact note: Compact skipped: context too large')
    })

    describe('no prompt disarms it', () => {
      async function armedTimed($: Engine, on: On) {
        const w = world(on)
        compacting(on, w)
        on('classic.UserPromptSubmit', async () => ({}) as never)
        await start($)
        await turn($)
        await run($, 'compact')
        return w
      }
      test('a prompt you typed does not cancel it: the compact is permanent until off', async ($, on) => {
        const w = await armedTimed($, on)
        await submit($, 'I am back', 'user')
        expect(stateOf(w)).toMatchObject({ compactArmed: true, phase: 'stopped' })
        expect(w.toasts).toEqual([])
      })
      for (const text of [
        '<task-notification>\n<task-id>x</task-id></task-notification>',
        'Another Claude session sent a message:\n<agent-message from="a">hi</agent-message>',
        'Base directory for this skill: /x/.claude/skills/spectra-apply',
        '<command-message>spectra-apply</command-message>',
      ]) {
        test(`${text.slice(0, 30).replace(/\n/g, ' ')}… does not disarm it either`, async ($, on) => {
          const w = await armedTimed($, on)
          await submit($, text)
          await submit($, text, 'user')
          expect(stateOf(w)).toMatchObject({ compactArmed: true, phase: 'stopped' })
          expect(w.toasts).toEqual([])
        })
      }
    })
  })

  describe('brb break-even note', () => {
    const brb = async ($: Engine, on: On, model: string, minutes: number) => {
      const w = world(on)
      on('session.model', async () => ({ value: model }) as never)
      await start($)
      await turn($)
      const r = (await $.command.run({ command: 'keepalive', args: `brb ${minutes}` } as never)) as { text: string }
      return { w, text: r.text }
    }
    test('24 h on Opus 5.5 is under its break-even: no note', async ($, on) => {
      expect((await brb($, on, 'claude-opus-5-5', 1440)).text).not.toContain('break-even')
    })
    test('24 h on Sonnet 5.5 is past its break-even (about 17 h)', async ($, on) => {
      const { text } = await brb($, on, 'claude-sonnet-5-5', 1440)
      expect(text).toContain('break-even for claude-sonnet-5-5 (about 20 pings, 17 h)')
    })
    test('48 h on Fable 5.1 is under its break-even', async ($, on) => {
      expect((await brb($, on, 'claude-fable-5-1', 2880)).text).not.toContain('break-even')
    })
    test('60 h on Opus 5.5 is past 40 pings', async ($, on) => {
      expect((await brb($, on, 'claude-opus-5-5', 3600)).text).toContain('about 40 pings, 33 h')
    })
    test('an unknown model gets no note', async ($, on) => {
      expect((await brb($, on, 'some-other-model', 3600)).text).not.toContain('break-even')
    })
  })

  describe('the armed flag when you come back (it stays)', () => {
    // The engine's classic UserPromptSubmit: `source` says who wrote the prompt.
    const submit = ($: Engine, prompt: string, source: string) =>
      ($ as never as { classic: { UserPromptSubmit: (e: object) => Promise<unknown> } }).classic.UserPromptSubmit({ prompt, source })
    async function armed($: Engine, on: On) {
      const w = world(on)
      compacting(on, w)
      on('classic.UserPromptSubmit', async () => ({}) as never)
      await start($)
      await turn($)
      await $.command.run({ command: 'keepalive', args: 'compact' } as never)
      return w
    }
    test('a plain prompt you typed leaves it armed and says nothing', async ($, on) => {
      const w = await armed($, on)
      await submit($, 'I am back', 'user')
      expect(stateOf(w)).toMatchObject({ compactArmed: true })
      expect(w.toasts).toEqual([])
    })
    test('a plain prompt with no source (this build omits it) leaves it armed too', async ($, on) => {
      const w = await armed($, on)
      await (($ as never as { classic: { UserPromptSubmit: (e: object) => Promise<unknown> } }).classic).UserPromptSubmit({ prompt: 'I am back' })
      expect(stateOf(w)).toMatchObject({ compactArmed: true })
    })
    test('a slash command you typed does not (/goal comes right after arming)', async ($, on) => {
      const w = await armed($, on)
      await submit($, '/goal make three files', 'user')
      await submit($, '/keepalive status', 'user')
      expect(stateOf(w)).toMatchObject({ compactArmed: true })
      expect(w.toasts).toEqual([])
    })
    test('a prompt the engine wrote (a /goal continuation) does not', async ($, on) => {
      const w = await armed($, on)
      await submit($, 'Stop hook feedback: only 1.txt exists', 'system')
      await submit($, 'wakeup', 'loop_wakeup')
      expect(stateOf(w)).toMatchObject({ compactArmed: true })
    })
    test('with nothing armed it says nothing', async ($, on) => {
      const w = world(on)
      compacting(on, w)
      on('classic.UserPromptSubmit', async () => ({}) as never)
      await start($)
      await turn($)
      await submit($, 'hello', 'user')
      expect(w.toasts).toEqual([])
    })
  })

  describe('brb duration', () => {
    const run = async ($: Engine, args: string) => ((await $.command.run({ command: 'keepalive', args } as never)) as { text: string }).text
    test('"24h" is 1440 minutes: 29 pings', async ($, on) => {
      const w = world(on)
      await start($)
      await turn($)
      expect(await run($, 'brb 24h')).toContain('about 1440 min: up to 29 pings')
      expect(stateOf(w)).toMatchObject({ max: 29 })
    })
    test('"180", "180m" and "3h" all mean the same 180 minutes', async ($, on) => {
      world(on)
      await start($)
      await turn($)
      for (const v of ['180', '180m', '3h']) {
        expect(await run($, `brb ${v}`)).toContain('about 180 min: up to 4 pings')
      }
    })
    test('anything else is a usage message', async ($, on) => {
      world(on)
      await start($)
      await turn($)
      for (const v of ['24hours', 'h', '-5', '0', 'abc']) {
        expect(await run($, `brb ${v}`)).toContain('Usage: /keepalive brb')
      }
    })
  })

  describe('brb reset and wording', () => {
    const run = async ($: Engine, args: string) => ((await $.command.run({ command: 'keepalive', args } as never)) as { text: string }).text
    test('"1 ping" is singular, "2 pings" plural', async ($, on) => {
      world(on)
      await start($)
      await turn($)
      expect(await run($, 'brb 30')).toContain('up to 1 ping this idle stretch')
      expect(await run($, 'brb 60')).toContain('up to 2 pings this idle stretch')
    })
    // A timed compact is no-ping by design: brb adds pings and moves the compact to the
    // window's end, and reset takes both back instead of leaving the pings-first mode behind.
    test('brb reset on a timed compact goes back to no pings and the timed compact', async ($, on) => {
      const w = world(on)
      compacting(on, w)
      await start($)
      await turn($)
      await run($, 'compact')
      await run($, 'brb 24h')
      expect(stateOf(w)).toMatchObject({ max: 28, phase: 'armed', compactArmed: true, compactAt: T0 + 24 * 60 * MIN })
      const text = await run($, 'brb reset')
      expect(text).toContain('Back to the timed compact: no pings')
      expect(stateOf(w)).toMatchObject({ phase: 'stopped', compactArmed: true, compactAt: T0 + 50 * MIN })
    })
    test('"RESET" works too, and the pings really are 2 again', async ($, on) => {
      const w = world(on)
      await start($)
      await turn($)
      await run($, 'brb 24h')
      await run($, 'brb RESET')
      await w.clock.advance(100 * MIN)
      expect(w.forks).toBe(2)
      expect(stateOf(w)).toMatchObject({ phase: 'capped' })
    })
    test('reset after the default pings are already sent leaves it capped', async ($, on) => {
      const w = world(on)
      await start($)
      await turn($)
      await run($, 'brb 24h')
      await w.clock.advance(150 * MIN) // 3 pings sent, more than the default of 2
      expect(w.forks).toBe(3)
      const text = await run($, 'brb reset')
      expect(text).toContain('Back to the default of 2 pings: the 3 pings already sent use it up')
      expect(stateOf(w)).toMatchObject({ phase: 'capped', pings: 3, max: 3 })
      await w.clock.advance(4 * 60 * MIN)
      expect(w.forks).toBe(3)
    })
    test('with a default of 0 pings, reset says so', { options: { maxPings: 0 } }, async ($, on) => {
      world(on)
      await start($)
      await turn($)
      expect(await run($, 'brb 120')).toContain('up to 3 pings')
      expect(await run($, 'brb reset')).toBe('Back to the default: no pings this idle stretch.')
    })
    test('reset is refused where brb is: off, small, expired', async ($, on) => {
      const w = world(on, { context: 10_000 })
      await start($)
      await turn($)
      expect(await run($, 'brb reset')).toContain('small enough')
    })
  })

  describe('colour in command replies', () => {
    const ESC = String.fromCharCode(27)
    const run = async ($: Engine, args: string) => ((await $.command.run({ command: 'keepalive', args } as never)) as { text: string }).text
    test('on a terminal the usage error is red and the break-even warning is yellow, on its own line', async ($, on) => {
      const w = world(on)
      on('session.model', async () => ({ value: 'claude-sonnet-5-5' }) as never)
      await start($)
      await turn($)
      expect(await run($, 'brb abc')).toContain(`${ESC}[31mUsage`)
      const text = await run($, 'brb 24h')
      expect(text).toContain(`\n${ESC}[33m⚠ Past the break-even for claude-sonnet-5-5`)
      expect(stateOf(w)).toMatchObject({ max: 29 })
    })
    test('status colours the phase: armed green', async ($, on) => {
      world(on)
      await start($)
      await turn($)
      expect(await run($, 'status')).toContain(`phase: ${ESC}[32marmed${ESC}[0m`)
    })
    test('off a terminal there are no escape codes at all', async ($, on) => {
      world(on)
      on('session.model', async () => ({ value: 'claude-sonnet-5-5' }) as never)
      await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
      await turn($)
      for (const args of ['brb abc', 'brb 24h', 'status', 'compact']) {
        expect(await run($, args)).not.toContain(ESC)
      }
    })
  })
})

describe("the engine's own auto compaction (idle or over threshold)", () => {
  const FAKE_TRANSCRIPT = [{ role: 'user', text: 'hi', toolUses: [] }]
  // The engine compacting on its own, not through the mod's /keepalive compact:
  // tests raise it the same way the host does, by calling $.session.compact
  // with trigger 'auto' directly.
  test('cancels the pending ping and resets state when the engine compacts while idle', async ($, on) => {
    const w = world(on)
    on('session.compact', async () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 180_000, tokensAfter: 14_000 }) as never)
    await start($)
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 0 })

    await w.clock.advance(49 * MIN)
    await $.session.compact({ trigger: 'auto', messages: FAKE_TRANSCRIPT } as never)
    expect(stateOf(w)).toMatchObject({ phase: 'active', contextTokens: 14_000 })
    expect(w.toasts.at(-1)).toContain('Compacted automatically before the cache expired')

    // The old ping timer (due at +50) must not have survived the reconciliation.
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(0)
  })

  test('a vetoed auto compaction restores the schedule instead of dropping it', async ($, on) => {
    const w = world(on)
    on('session.compact', async () => ({ skip: 'off' }) as never)
    await start($)
    await turn($)
    await w.clock.advance(49 * MIN)
    await $.session.compact({ trigger: 'auto', messages: FAKE_TRANSCRIPT } as never)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 0 })

    await w.clock.advance(1 * MIN)
    expect(w.forks).toBe(1) // the ping at +50 still fires, as if nothing happened
  })

  test('a manual /compact also cancels the ping: the new prefix is not cached yet', async ($, on) => {
    const w = world(on)
    on('session.compact', async () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 291_000, tokensAfter: 44_000 }) as never)
    await start($)
    await turn($)
    await w.clock.advance(10 * MIN)
    await $.session.compact({ trigger: 'manual', messages: FAKE_TRANSCRIPT } as never)
    expect(stateOf(w)).toMatchObject({ phase: 'active', contextTokens: 44_000 })
    expect(w.toasts.at(-1)).toContain('keepalive resumes after your next turn')

    // no ping at +50 into a cache nobody wrote, so no ttl-mismatch
    await w.clock.advance(2 * 60 * MIN)
    expect(w.forks).toBe(0)
    expect(stateOf(w)).toMatchObject({ phase: 'active' })

    // the next turn writes the new cache and arms again
    await turn($)
    expect(stateOf(w)).toMatchObject({ phase: 'armed', pings: 0 })
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a vetoed manual /compact restores the schedule', async ($, on) => {
    const w = world(on)
    on('session.compact', async () => ({ skip: 'off' }) as never)
    await start($)
    await turn($)
    await w.clock.advance(10 * MIN)
    await $.session.compact({ trigger: 'manual', messages: FAKE_TRANSCRIPT } as never)
    expect(stateOf(w)).toMatchObject({ phase: 'armed' })
    await w.clock.advance(45 * MIN)
    expect(w.forks).toBe(1)
  })

  test("a subagent's or fork's own auto compaction is left alone", async ($, on) => {
    const w = world(on)
    let calls = 0
    on('session.compact', async () => {
      calls += 1
      return { messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensAfter: 1_000 } as never
    })
    await start($)
    await turn($)
    await $.session.compact({ trigger: 'auto', messages: FAKE_TRANSCRIPT, agentId: 'fork-1' } as never)
    expect(calls).toBe(1)
    expect(stateOf(w)).toMatchObject({ phase: 'armed' }) // unaffected

    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1) // the main session's own ping still ran on schedule
  })
})
