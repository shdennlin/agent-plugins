import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, Timer } from 'claude-code'

import type { KeepaliveSession } from '../types'
import { header, htmlEscape, keyboard, parseUpdate } from './telegram'

// Keeps the main thread's prompt cache warm while the user is idle: one fork
// ping shortly before the TTL runs out, capped per idle stretch, verified on
// every hit. Display lives in the status line (bin/keepalive-cache reads the
// per-session state file). $.ui.status is used only when engineStatus is on:
// the engine draws it as its own warning-prefixed row under the prompt.

const PING_PROMPT = 'Cache keep-alive ping, not a task. Reply with exactly: ok'
const HIT_RATIO = 0.8
const TAIL_BYTES = 262144
const RETRY_MS = 30_000
const STALE_FILE_MS = 7 * 24 * 60 * 60 * 1000
const TTL_1H = 3600
const TTL_5M = 300
// /keepalive brb completions, the first one offered on an empty argument.
const BRB_PRESETS = ['180', '60', '480']
const TG_POLL_MS = 10_000
const TG_API = 'https://api.telegram.org'
const KEYCHAIN_SERVICE = 'claude-code.cache-keepalive'
const KEYCHAIN_ACCOUNT = 'telegram-bot-token'

const INITIAL: KeepaliveSession = {
  phase: 'active',
  offReason: null,
  lastActivityAt: 0,
  lastPingAt: 0,
  pingsSent: 0,
  maxPings: 2,
  ttlSec: null,
  contextTokens: 0,
  transcriptPath: null,
  isBandDismissed: false,
  isOffToastShown: false,
  tgAskMessageId: null,
}

const session = atom({ plugin: 'cache-keepalive', key: 'session' } as const, INITIAL)

type Config = {
  enabled: boolean
  leadMinutes: number
  maxPings: number
  minContextTokens: number
  engineStatus: boolean
  telegramChatId: string
  telegramUserId: string
}

// Module variables start over on a hot reload; the engine drops the old
// timers with them, and session.start re-arms from $.state.
let config: Config = {
  enabled: true,
  leadMinutes: 5,
  maxPings: 2,
  minContextTokens: 50000,
  engineStatus: false,
  telegramChatId: '',
  telegramUserId: '',
}
let pingTimer: Timer | undefined
let expiryTimer: Timer | undefined
let isRetrying = false
let sessionId = ''
let stateDir = ''
let projectsDir = ''
// The dim completion tail this module last put after the prompt draft.
let brbTail = ''
let cwd = ''
// Telegram: the resolved bot token (never written anywhere) and the poller.
let tgTokenOption = ''
let tgToken = ''
let tgPoll: Timer | undefined
let isPolling = false

export const register: Register = (on, options) => {
  config = {
    enabled: options.enabled !== false,
    leadMinutes: positiveNumber(options.leadMinutes, 5),
    maxPings: Math.max(0, Math.floor(positiveNumber(options.maxPings, 2, true))),
    minContextTokens: positiveNumber(options.minContextTokens, 50000, true),
    engineStatus: options.engineStatus === true,
    telegramChatId: String(options.telegramChatId ?? '').trim(),
    telegramUserId: String(options.telegramUserId ?? '').trim(),
  }
  tgTokenOption = String(options.telegramBotToken ?? '').trim()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keepalive',
      description: 'Prompt-cache keepalive: done, brb <minutes>, status',
      argumentHint: 'done | brb <minutes> | status',
    })
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
    stateDir = `${configDir}/keepalive`
    projectsDir = `${configDir}/projects/${e.cwd.replace(/[^A-Za-z0-9]/g, '-')}`
    cwd = e.cwd
    tgToken = await resolveTelegramToken($)
    await bindSession($)
    await rearm($)
    // After a reload, keep listening for the answer to a question still open.
    if ((await read($, session)).tgAskMessageId !== null && isTelegramOn()) startPolling($)
    await sweepStaleFiles($)
    return next(e)
  })

  // The settings hook envelope carries the real transcript path; the one
  // derived from cwd in bindSession is only the fallback.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const s = await read($, session)
    if (e.transcript_path && e.transcript_path !== s.transcriptPath) {
      await update($, session, v => ({ ...v, transcriptPath: e.transcript_path }))
    }
    return next(e)
  })

  // Only the main loop raises turn.start; a subagent's run does not.
  on('turn.start', async ($, e, next) => {
    await bindSession($)
    cancelTimers()
    isRetrying = false
    await closeAsk($, '↩️ Back at the keyboard.')
    await save($, v => ({
      ...v,
      // Off stays off for the session, except when the off switch itself was
      // turned back on (a config change reloads the module with new options).
      ...(v.phase === 'off' && !(v.offReason === 'disabled' && config.enabled)
        ? {}
        : { phase: 'active' as const, offReason: null }),
      pingsSent: 0,
      maxPings: config.maxPings,
      lastPingAt: 0,
      isBandDismissed: false,
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await bindSession($)
    await onMainTurnComplete($, e.reason)
    return result
  })

  on('session.end', async ($, e, next) => {
    cancelTimers()
    await closeAsk($, 'Session ended.')
    if (sessionId) {
      await $.process.run(['rm', '-f', stateFile()]).catch(() => undefined)
    }
    return next(e)
  })

  // Fish-style completion for /keepalive brb: a dim tail after the draft,
  // Right arrow to accept. Tab and Up/Down never reach prompt.edit (the
  // editor keeps them), and Enter runs what the box shows, tail included.
  on('prompt.edit', async ($, e, next) => {
    const shown = brbTail
    brbTail = ''
    const hasTail = shown !== '' && e.text.endsWith(shown) && e.cursor === e.text.length - shown.length
    if (hasTail && e.key?.key === 'right') {
      return { text: e.text, cursor: e.text.length }
    }
    let draft = e
    if (hasTail) {
      // Take the tail back out so the edit applies to what was typed.
      const text = e.text.slice(0, -shown.length)
      draft = { ...e, text, start: Math.min(e.start, text.length), end: Math.min(e.end, text.length) }
    }
    const box = await next(draft)
    const tail = brbCompletion(box.text, box.cursor)
    if (!tail) return box
    brbTail = tail
    const at = box.text.length
    return {
      ...box,
      text: box.text + tail,
      decorations: [...(box.decorations ?? []), { start: at, end: at + tail.length, dimColor: true }],
    }
  })

  on('command.run', { command: 'keepalive' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, session)
    if (e.props.hasSurvey || s.phase !== 'expired' || s.isBandDismissed) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const rate = s.ttlSec === TTL_5M ? 1.25 : 2
    const tokens = s.contextTokens
    return (
      <Box>
        <Text color="cyan">
          ❄ Cache expired at {clockTime(cacheStart(s) + (s.ttlSec ?? TTL_1H) * 1000)} · next request rewrites ~
          {kilo(tokens)} (≈ {kilo(tokens * rate)} at the write rate){' '}
        </Text>
        <Button
          key="dismiss"
          label="Dismiss"
          role="dismiss"
          onPress={() => update($, session, v => ({ ...v, isBandDismissed: true }))}
        />
      </Box>
    )
  })
}

async function onMainTurnComplete($: Engine, reason: string) {
  const s = await read($, session)
  if (s.phase === 'off') return writeStateFile($, s)
  if (!config.enabled) {
    await save($, v => ({ ...v, phase: 'off', offReason: 'disabled' }))
    return
  }
  const now = await $.clock.now()
  if (reason === 'error' || reason === 'refusal') {
    await save($, v => ({ ...v, phase: 'active', lastActivityAt: now }))
    return
  }
  // An aborted turn may carry no usage: keep the last known values then.
  const usage = await $.session.usage().catch(() => undefined)
  const contextTokens = usage?.context?.tokens ?? s.contextTokens
  const ttlSec = (await readTtl($, s.transcriptPath)) ?? s.ttlSec
  const base = { ...s, lastActivityAt: now, contextTokens, ttlSec }

  if (ttlSec === TTL_5M) {
    // 13 pings an hour at 0.1x cost more than one 1.25x rewrite.
    await save($, () => ({ ...base, phase: 'off', offReason: '5m-ttl' }))
    return
  }
  if (contextTokens < config.minContextTokens) {
    await save($, () => ({ ...base, phase: 'small' }))
    return
  }
  if (ttlSec === null) {
    // Not read yet: no schedule. The next turn tries again.
    await save($, () => ({ ...base, phase: 'active' }))
    return
  }
  await save($, () => ({ ...base, phase: base.maxPings > 0 ? 'armed' : 'capped' }))
  await rearm($)
}

// Schedules the next ping (armed) and the expiry (armed or capped) from state.
async function rearm($: Engine) {
  cancelTimers()
  const s = await read($, session)
  if ((s.phase !== 'armed' && s.phase !== 'capped') || s.ttlSec === null) return
  const now = await $.clock.now()
  const expiresAt = cacheStart(s) + s.ttlSec * 1000
  if (s.phase === 'armed') {
    const pingAt = expiresAt - config.leadMinutes * 60_000
    pingTimer = $.clock.after(Math.max(0, pingAt - now), () => {
      void ping($)
    })
  }
  expiryTimer = $.clock.after(Math.max(0, expiresAt - now), () => {
    void expire($)
  })
}

async function ping($: Engine) {
  const s = await read($, session)
  if (s.phase !== 'armed' || s.ttlSec === null) return
  const startedAt = await $.clock.now()
  if (startedAt >= cacheStart(s) + s.ttlSec * 1000) {
    // The timer fired late (the Mac slept): the cache is already gone, and a
    // ping now would pay a full rewrite and read as a miss.
    await expire($)
    return
  }
  const r = await $.model.fork({ prompt: PING_PROMPT })
  const after = await read($, session)
  if (after.phase !== 'armed') return // a turn started while the fork ran

  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    cancelTimers()
    await save($, v => ({ ...v, phase: 'active' }))
    return
  }
  const usage = 'usage' in r ? r.usage : undefined
  const prefix = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
  if (!usage || prefix === 0) {
    // api-error or aborted with nothing sent: retry once, then give up.
    if (!isRetrying) {
      isRetrying = true
      pingTimer = $.clock.after(RETRY_MS, () => {
        void ping($)
      })
      return
    }
    await turnOff($, 'api-error')
    return
  }
  isRetrying = false
  const isHit = usage.cache_read_input_tokens / prefix >= HIT_RATIO
  await recordStats($, isHit)
  if (!isHit) {
    await turnOff($, 'ttl-mismatch')
    return
  }
  await save($, v => {
    const pingsSent = v.pingsSent + 1
    return { ...v, pingsSent, lastPingAt: startedAt, phase: pingsSent >= v.maxPings ? 'capped' : 'armed' }
  })
  await rearm($)
  if ((await read($, session)).phase === 'capped') await askOnTelegram($)
}

async function expire($: Engine) {
  const s = await read($, session)
  if (s.phase !== 'armed' && s.phase !== 'capped') return
  cancelTimers()
  await save($, v => ({ ...v, phase: 'expired' }))
  if (s.ttlSec !== null) await closeAsk($, `❄️ Cache expired at ${clockTime(cacheStart(s) + s.ttlSec * 1000)}.`)
}

async function turnOff($: Engine, offReason: 'api-error' | 'ttl-mismatch') {
  cancelTimers()
  const s = await save($, v => ({ ...v, phase: 'off', offReason }))
  if (!s.isOffToastShown) {
    const why =
      offReason === 'ttl-mismatch'
        ? 'the ping missed the cache, so this session’s cache lasts less than the ping interval'
        : 'the ping failed twice with an API error'
    $.ui.toast(`cache-keepalive off for this session: ${why}.`)
    await update($, session, v => ({ ...v, isOffToastShown: true }))
  }
}

async function runCommand($: Engine, args: string): Promise<string> {
  const [verb = 'status', value] = args.trim().split(/\s+/)
  const s = await read($, session)

  if (verb === 'done') {
    cancelTimers()
    if (s.phase === 'off') return 'Keepalive is already off for this session.'
    await save($, v => ({ ...v, phase: 'stopped' }))
    await closeAsk($, '💤 Stopped with /keepalive done.')
    return 'Keepalive stopped until your next prompt.'
  }

  if (verb === 'brb') {
    const minutes = Number(value)
    if (!Number.isFinite(minutes) || minutes <= 0) return 'Usage: /keepalive brb <minutes>, for example /keepalive brb 180'
    if (s.phase === 'off') return `Keepalive is off for this session (${s.offReason}).`
    if (s.phase === 'small') return 'This session’s context is small enough that a rewrite is cheap; not keeping it warm.'
    if (s.ttlSec === null || s.phase === 'active') return 'Nothing to keep warm yet: wait for the current turn to finish.'
    if (s.phase === 'expired') return 'The cache has already expired; your next prompt rewrites it.'
    const intervalSec = s.ttlSec - config.leadMinutes * 60
    const maxPings = Math.max(s.pingsSent + 1, Math.ceil((minutes * 60) / intervalSec))
    await save($, v => ({ ...v, maxPings, phase: v.pingsSent < maxPings ? 'armed' : 'capped' }))
    await rearm($)
    const now = await $.clock.now()
    const next = Math.max(now, cacheStart(s) + s.ttlSec * 1000 - config.leadMinutes * 60_000)
    return `Keeping the cache warm for about ${minutes} min: up to ${maxPings} pings this idle stretch, next at ${clockTime(next)}.`
  }

  if (verb === 'status') {
    const stats = ((await $.store.get('stats')) as Stats | undefined) ?? { pings: 0, hits: 0 }
    const lines = [
      `phase: ${s.phase}${s.offReason ? ` (${s.offReason})` : ''}`,
      `ttl: ${s.ttlSec === null ? 'not read yet' : `${s.ttlSec / 60} min`}`,
      `context: ${kilo(s.contextTokens)} tokens (minimum ${kilo(config.minContextTokens)})`,
      `pings this idle stretch: ${s.pingsSent}/${s.maxPings}`,
    ]
    if (s.ttlSec !== null && (s.phase === 'armed' || s.phase === 'capped')) {
      const expiresAt = cacheStart(s) + s.ttlSec * 1000
      if (s.phase === 'armed') lines.push(`next ping: ${clockTime(expiresAt - config.leadMinutes * 60_000)}`)
      lines.push(`cache expires: ${clockTime(expiresAt)}`)
    }
    lines.push(`telegram: ${isTelegramOn() ? `on (chat ${config.telegramChatId}${s.tgAskMessageId !== null ? ', question open' : ''})` : 'off'}`)
    lines.push(`all sessions: ${stats.pings} pings, ${stats.hits} hits`)
    return lines.join('\n')
  }

  return 'Usage: /keepalive done | brb <minutes> | status'
}

type Stats = { pings: number; hits: number }

// --- Telegram: ask once the pings run out, read the answer by polling ---

function isTelegramOn(): boolean {
  return tgToken !== '' && config.telegramChatId !== ''
}

async function resolveTelegramToken($: Engine): Promise<string> {
  if (tgTokenOption) return tgTokenOption
  const fromEnv = (await $.env.get('CLAUDE_KEEPALIVE_TELEGRAM_BOT_TOKEN'))?.trim()
  if (fromEnv) return fromEnv
  const r = await $.process
    .run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'])
    .catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}

// One Bot API call; undefined on any failure (network, HTTP, ok: false).
async function telegram($: Engine, method: string, body: Record<string, unknown>): Promise<unknown> {
  if (!tgToken) return undefined
  const res = await $.http
    .fetch(`${TG_API}/bot${tgToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => undefined)
  if (!res) return undefined
  try {
    const data = JSON.parse(res.text) as { ok?: boolean; result?: unknown }
    return data.ok ? data.result : undefined
  } catch {
    return undefined
  }
}

async function askOnTelegram($: Engine) {
  const s = await read($, session)
  if (!isTelegramOn() || s.tgAskMessageId !== null || s.ttlSec === null) return
  const expiresAt = cacheStart(s) + s.ttlSec * 1000
  const rate = s.ttlSec === TTL_5M ? 1.25 : 2
  const text = [
    await sessionHeader($),
    `🧊 Cache expires at <b>${clockTime(expiresAt)}</b> · ${kilo(s.contextTokens)} context`,
    `Rewrite ≈ ${kilo(s.contextTokens * rate)} · one more hour warm ≈ ${kilo(s.contextTokens * 0.1)}`,
    'Tap a button, or reply with minutes (e.g. 120).',
  ].join('\n')
  const sent = (await telegram($, 'sendMessage', {
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard(sessionId.slice(0, 8)),
  })) as { message_id?: number } | undefined
  if (typeof sent?.message_id !== 'number') return
  await update($, session, v => ({ ...v, tgAskMessageId: sent.message_id as number }))
  startPolling($)
}

function startPolling($: Engine) {
  stopPolling()
  tgPoll = $.clock.every(TG_POLL_MS, () => {
    void pollOnce($)
  })
}

function stopPolling() {
  tgPoll?.cancel()
  tgPoll = undefined
}

// Reads pending updates without confirming an offset: other sessions and
// machines share the bot, and confirming would delete their answers. With
// the bot's privacy mode on, only button presses and replies are pending,
// and Telegram drops them after 24 hours.
async function pollOnce($: Engine) {
  if (isPolling) return
  isPolling = true
  try {
    const s = await read($, session)
    if (s.tgAskMessageId === null) {
      stopPolling()
      return
    }
    const updates = await telegram($, 'getUpdates', { timeout: 0, limit: 100 })
    if (!Array.isArray(updates)) return
    const target = {
      chatId: config.telegramChatId,
      userId: config.telegramUserId,
      messageId: s.tgAskMessageId,
      sessionTag: sessionId.slice(0, 8),
    }
    const handled = ((await $.store.get('tgHandled')) as number[] | undefined) ?? []
    for (const u of updates) {
      const answer = parseUpdate(u, target)
      if (!answer || handled.includes(answer.updateId)) continue
      // Updates stay pending (no offset is confirmed), so remember which ones
      // were already answered: one press must never count twice.
      await $.store.set('tgHandled', [...handled, answer.updateId].slice(-200))
      await applyAnswer($, answer.minutes, answer.callbackId)
      return
    }
  } finally {
    isPolling = false
  }
}

async function applyAnswer($: Engine, minutes: number, callbackId: string | undefined) {
  const s = await read($, session)
  let line: string
  if (s.phase !== 'armed' && s.phase !== 'capped') {
    line = s.phase === 'expired' ? '❄️ Too late: the cache already expired.' : 'Nothing to keep warm now.'
  } else if (s.ttlSec === null) {
    line = 'Nothing to keep warm now.'
  } else if (minutes === 0) {
    cancelTimers()
    await save($, v => ({ ...v, phase: 'stopped' }))
    line = `💤 Letting it expire at ${clockTime(cacheStart(s) + s.ttlSec * 1000)}.`
  } else {
    const intervalMs = (s.ttlSec - config.leadMinutes * 60) * 1000
    // Each ping adds one interval (TTL − lead, 55 min on a 1h TTL): "+1h" is
    // one more ping, not two.
    const extra = Math.max(1, Math.round((minutes * 60_000) / intervalMs))
    await save($, v => ({ ...v, maxPings: v.pingsSent + extra, phase: 'armed' }))
    await rearm($)
    const until = cacheStart(s) + extra * intervalMs + s.ttlSec * 1000
    line = `✅ Keeping it warm until about ${clockTime(until)} (${extra} more ping${extra > 1 ? 's' : ''}).`
  }
  if (callbackId) await telegram($, 'answerCallbackQuery', { callback_query_id: callbackId, text: line })
  await closeAsk($, line)
}

// Ends the open question: the message shows the outcome and loses its buttons.
async function closeAsk($: Engine, line: string) {
  const s = await read($, session)
  if (s.tgAskMessageId === null) return
  stopPolling()
  await update($, session, v => ({ ...v, tgAskMessageId: null }))
  await telegram($, 'editMessageText', {
    chat_id: config.telegramChatId,
    message_id: s.tgAskMessageId,
    text: `${await sessionHeader($)}\n${htmlEscape(line)}`,
    parse_mode: 'HTML',
  })
}

// "<project> · <session title>", the header session-notifier uses.
async function sessionHeader($: Engine): Promise<string> {
  const project = cwd.split('/').filter(Boolean).pop() ?? 'claude'
  const s = await read($, session)
  let title: string | null = null
  if (s.transcriptPath) {
    const r = await $.process
      .run(['grep', '-h', '-E', '^\\{"type":"(custom-title|ai-title)"', s.transcriptPath])
      .catch(() => undefined)
    const rows = (r?.stdout ?? '').split('\n').filter(Boolean)
    title = lastTitle(rows, 'custom-title', 'customTitle') ?? lastTitle(rows, 'ai-title', 'aiTitle')
  }
  return header(project, title ?? sessionId.slice(0, 8))
}

function lastTitle(rows: string[], type: string, field: string): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(rows[i] ?? '') as Record<string, unknown>
      if (row.type === type && typeof row[field] === 'string' && row[field]) return row[field] as string
    } catch {
      continue
    }
  }
  return null
}

async function recordStats($: Engine, isHit: boolean) {
  const stats = ((await $.store.get('stats')) as Stats | undefined) ?? { pings: 0, hits: 0 }
  await $.store.set('stats', { pings: stats.pings + 1, hits: stats.hits + (isHit ? 1 : 0) })
}

// Follows the session id: after /clear the engine raises session.end and no
// session.start, and the next turn runs under a new id with a fresh state.
async function bindSession($: Engine) {
  const id = await $.session.id()
  if (id === sessionId) return
  const wasBound = sessionId !== ''
  sessionId = id
  if (wasBound) {
    cancelTimers()
    await update($, session, () => ({ ...INITIAL, maxPings: config.maxPings }))
  }
  const s = await read($, session)
  if (!s.transcriptPath || wasBound) {
    await update($, session, v => ({ ...v, transcriptPath: `${projectsDir}/${id}.jsonl` }))
  }
}

async function save($: Engine, change: (v: KeepaliveSession) => KeepaliveSession): Promise<KeepaliveSession> {
  const s = await update($, session, v => change(v ?? INITIAL))
  await writeStateFile($, s)
  return s
}

// The file bin/keepalive-cache reads; it holds data, and the script draws it.
async function writeStateFile($: Engine, s: KeepaliveSession) {
  if (!sessionId || !stateDir) return
  const data = {
    v: 1,
    phase: s.phase,
    offReason: s.offReason,
    ttlSec: s.ttlSec,
    lastPingAt: s.lastPingAt,
    pings: s.pingsSent,
    max: s.maxPings,
    contextTokens: s.contextTokens,
  }
  await $.fs.write(stateFile(), JSON.stringify(data) + '\n')
  if (config.engineStatus) $.ui.status(engineStatusText(s))
}

// Pushed only on state changes, never on a clock, so it names times rather
// than counting down.
function engineStatusText(s: KeepaliveSession): string | undefined {
  const expiresAt = cacheStart(s) + (s.ttlSec ?? TTL_1H) * 1000
  switch (s.phase) {
    case 'armed':
      return `keep ${s.pingsSent}/${s.maxPings} · ping ${clockTime(expiresAt - config.leadMinutes * 60_000)}`
    case 'capped':
      return `keep ${s.pingsSent}/${s.maxPings} ⏸ · expires ${clockTime(expiresAt)}`
    case 'stopped':
      return `keep ⏸ · expires ${clockTime(expiresAt)}`
    case 'expired':
      return 'cache expired'
    case 'off':
      return s.offReason === 'disabled' ? undefined : `keep off · ${s.offReason}`
    default:
      return undefined // active, small
  }
}

// The TTL is not in the turn's usage; the transcript's assistant rows carry
// the 1h/5m split. The latest row that wrote to the cache decides, so a row
// not yet flushed when turn.complete fires costs nothing.
async function readTtl($: Engine, transcriptPath: string | null): Promise<number | null> {
  if (!transcriptPath) return null
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), transcriptPath]).catch(() => undefined)
  if (!r || r.exitCode !== 0) return null
  const lines = r.stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const ttl = ttlOfLine(lines[i] ?? '')
    if (ttl !== null) return ttl
  }
  return null
}

async function sweepStaleFiles($: Engine) {
  const entries = await $.fs.list(stateDir).catch(() => [])
  const now = await $.clock.now()
  for (const entry of entries) {
    if (entry.kind === 'file' && entry.name.endsWith('.json') && now - entry.mtimeMs > STALE_FILE_MS) {
      await $.process.run(['rm', '-f', `${stateDir}/${entry.name}`]).catch(() => undefined)
    }
  }
}

function brbCompletion(text: string, cursor: number): string {
  if (cursor !== text.length) return ''
  const m = /^\/keepalive\s+brb\s+(\d*)$/.exec(text)
  if (!m) return ''
  const typed = m[1] ?? ''
  const preset = BRB_PRESETS.find(p => p.startsWith(typed) && p.length > typed.length)
  return preset ? preset.slice(typed.length) : ''
}

function ttlOfLine(line: string): number | null {
  if (!line.includes('ephemeral_')) return null
  try {
    const entry = JSON.parse(line)
    if (entry.type !== 'assistant' || entry.isSidechain === true) return null
    const split = entry.message?.usage?.cache_creation
    if (!split) return null
    if ((split.ephemeral_5m_input_tokens ?? 0) > 0) return TTL_5M
    if ((split.ephemeral_1h_input_tokens ?? 0) > 0) return TTL_1H
    return null
  } catch {
    return null // the tail's first line is usually cut mid-row
  }
}

function stateFile(): string {
  return `${stateDir}/${sessionId}.json`
}

function cacheStart(s: KeepaliveSession): number {
  return Math.max(s.lastActivityAt, s.lastPingAt)
}

function cancelTimers() {
  // The Telegram poller is separate: a question stays open across re-arms.
  pingTimer?.cancel()
  expiryTimer?.cancel()
  pingTimer = undefined
  expiryTimer = undefined
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function kilo(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(Math.round(tokens))
}

function positiveNumber(value: unknown, fallback: number, allowZero = false): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return allowZero ? (n >= 0 ? n : fallback) : n > 0 ? n : fallback
}
