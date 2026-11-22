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
// A timed compact never fires sooner than this after it is armed: the host
// refuses a compaction under the command's own turn.
const MIN_TIMED_DELAY_MS = 30_000
// /keepalive brb completions, the first one offered on an empty argument.
const BRB_PRESETS = ['180', '60', '480']
// Pings that cost as much as one 1h-cache rewrite: the 1h write price (2x input)
// over the cache-read price, per the pricing page (checked 2026-10-07). Reads
// are 0.1x input on every model but Claude Fable 5.1 / Mythos 5.1 (0.025x) and
// Claude Opus 5.5 (0.05x).
function breakEvenPings(model: string): number | null {
  if (/(fable|mythos)-5-1/.test(model)) return 80
  if (/opus-5-5/.test(model)) return 40
  return /(fable|mythos|opus|sonnet|haiku)/.test(model) ? 20 : null
}
// Short forms for the commands typed most.
const VERB_ALIASES: Record<string, string> = { c: 'compact', d: 'done', p: 'ping', s: 'status' }
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
  isCompactArmed: false,
  compactAfterMin: null,
  brbUntil: null,
  lastCompactNote: null,
}

const session = atom({ plugin: 'cache-keepalive', key: 'session' } as const, INITIAL)

type Config = {
  enabled: boolean
  leadMinutes: number
  compactLeadMinutes: number
  compactAfterMinutes: number
  maxPings: number
  minContextTokens: number
  engineStatus: boolean
  compactBeforeExpiry: boolean
  telegramChatId: string
  telegramUserId: string
}

// Module variables start over on a hot reload; the engine drops the old
// timers with them, and session.start re-arms from $.state.
let config: Config = {
  enabled: true,
  leadMinutes: 10,
  compactLeadMinutes: 10,
  compactAfterMinutes: 50,
  maxPings: 2,
  minContextTokens: 50000,
  engineStatus: false,
  compactBeforeExpiry: false,
  telegramChatId: '',
  telegramUserId: '',
}
let pingTimer: Timer | undefined
let expiryTimer: Timer | undefined
let compactTimer: Timer | undefined
let isCompacting = false
let isRetrying = false
// ANSI colour in a command's reply: the terminal draws it (checked: bold, dim,
// 16 colours, backgrounds and truecolor), other surfaces may show the codes.
let isTerminal = false
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
    leadMinutes: positiveNumber(options.leadMinutes, 10),
    compactLeadMinutes: positiveNumber(options.compactLeadMinutes, 10),
    compactAfterMinutes: positiveNumber(options.compactAfterMinutes, 50),
    maxPings: Math.max(0, Math.floor(positiveNumber(options.maxPings, 2, true))),
    minContextTokens: positiveNumber(options.minContextTokens, 50000, true),
    engineStatus: options.engineStatus === true,
    compactBeforeExpiry: options.compactBeforeExpiry === true,
    telegramChatId: String(options.telegramChatId ?? '').trim(),
    telegramUserId: String(options.telegramUserId ?? '').trim(),
  }
  tgTokenOption = String(options.telegramBotToken ?? '').trim()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keepalive',
      description: 'Prompt-cache keepalive: done, brb <minutes|hours|reset>, compact [minutes|pings|off], ping, status',
      argumentHint: 'done | brb <minutes|hours|reset> | compact [minutes|pings|off] | ping | status (d = done, c = compact, p = ping, s = status)',
    })
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
    stateDir = `${configDir}/keepalive`
    projectsDir = `${configDir}/projects/${e.cwd.replace(/[^A-Za-z0-9]/g, '-')}`
    cwd = e.cwd
    isTerminal = e.surface === 'terminal'
    tgToken = await resolveTelegramToken($)
    await bindSession($)
    await rearm($)
    await armFromResume($)
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
    // You are back: an armed compact was for the time you are away. Only a prompt
    // you typed counts. `source` tells it from the engine's own turns (a /goal
    // continuation is `system`) where the engine sends it; this build leaves it
    // out (measured: undefined on typed prompts, and no event at all on a /goal
    // continuation), so an absent source counts as typed. A slash command does
    // not count: /goal and /keepalive status are typed too, and arming comes
    // before /goal.
    // With `source` absent, the engine's own deliveries still look typed: a
    // background task's <task-notification>, another session's or a subagent's
    // message, a skill's expanded body. Those never mean you are back (one-456:
    // an armed compact vanished before it fired, most likely to one of them).
    const text = e.prompt.trimStart()
    const isFromYou = (e.source === undefined || e.source === 'user') && !isEngineDelivered(text)
    const isTyped = isFromYou && text !== '' && !text.startsWith('/')
    if (s.isCompactArmed) {
      const peek = JSON.stringify(text.slice(0, 40))
      if (isTyped) {
        await save($, v => ({ ...v, isCompactArmed: false, compactAfterMin: null, lastCompactNote: `cancelled by a prompt you typed: ${peek}` }))
        if (s.phase === 'stopped' && s.compactAfterMin !== null) await restorePhase($)
        $.ui.toast('Armed compact cancelled: you are back. /keepalive compact arms it again.')
      } else {
        // Evidence for later: which prompts reach this hook, and who they claim to be from.
        await update($, session, v => ({ ...v, lastCompactNote: `kept: ${e.source ?? 'no source'} prompt ${peek}` }))
      }
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
      brbUntil: null,
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

  // Shared by both triggers. After either, the prefix is a fresh summary that
  // no request has written to the cache yet, so a ping would pay a full
  // rewrite, read as a miss and turn keepalive off for good. Phase goes to
  // active (no ping) until the next turn writes the new cache and re-arms.
  // Cancel the timers first: compaction takes about a minute at 140k tokens,
  // long enough to overlap a ping or expiry timer due during it.
  // The engine's own compaction (over the context threshold, a prompt too
  // long, or idle ahead of the cache TTL, added 2.1.299) and the user's
  // /compact are not turns, so turn.complete never tells the mod. Our own
  // /keepalive compact carries trigger 'plugin' and is handled in compact().
  // Hooks must be function literals, hence two handlers over one helper.
  // Cancel the timers first: compaction takes about a minute at 140k tokens,
  // long enough to overlap a ping or expiry timer due during it.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e) // a subagent's or fork's own transcript
    cancelTimers()
    const result = await next(e)
    await afterCompact($, result, 'Compacted automatically before the cache expired.')
    return result
  })
  on('session.compact', { trigger: 'manual' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    cancelTimers()
    const result = await next(e)
    await afterCompact($, result, 'Compacted: keepalive resumes after your next turn.')
    return result
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
    // An armed compact must still run (a /goal can end on an error while you
    // sleep). No usage is read and no pings run, since what the cache holds is
    // uncertain; the clock stays at the last good response so the lead window is
    // not pushed past the real expiry.
    const isArmed = s.isCompactArmed && s.ttlSec !== null && s.lastActivityAt > 0 && s.contextTokens >= config.minContextTokens
    if (isArmed) {
      await save($, v => ({ ...v, phase: 'capped' }))
      await rearm($)
    } else {
      await save($, v => ({ ...v, phase: 'active', lastActivityAt: now }))
    }
    return
  }
  // An aborted turn may carry no usage: keep the last known values then.
  const usage = await $.session.usage().catch(() => undefined)
  const contextTokens = usage?.context?.tokens ?? s.contextTokens
  const ttlSec = (await readTtl($, s.transcriptPath)) ?? s.ttlSec
  await applyArmedState($, { lastActivityAt: now, contextTokens, ttlSec })
}

// Shared by a just-completed turn (lastActivityAt = now) and a resumed
// session arming straight from the transcript (lastActivityAt = the real
// write time of its last cache-creating row, so an already-expired cache
// does not get a fresh window just because the process restarted).
async function applyArmedState($: Engine, input: { lastActivityAt: number; contextTokens: number; ttlSec: number | null }): Promise<void> {
  const s = await read($, session)
  const base = { ...s, ...input }

  if (input.ttlSec === TTL_5M) {
    // 13 pings an hour at 0.1x cost more than one 1.25x rewrite.
    await save($, () => ({ ...base, phase: 'off', offReason: '5m-ttl' }))
    return
  }
  if (input.contextTokens < config.minContextTokens) {
    await save($, () => ({ ...base, phase: 'small' }))
    return
  }
  if (input.ttlSec === null) {
    // Not read yet: no schedule. The next turn tries again.
    await save($, () => ({ ...base, phase: 'active' }))
    return
  }
  if (base.isCompactArmed && base.compactAfterMin !== null) {
    if (isTimedTooLong(base.compactAfterMin, input.ttlSec)) {
      // The cache would lapse before the timer: say so instead of dropping it silently.
      const note = `timed compact (${base.compactAfterMin} min) dropped: it must be at most ${maxTimedMinutes(input.ttlSec)} min for a ${input.ttlSec / 60} min cache`
      await save($, () => ({ ...base, isCompactArmed: false, compactAfterMin: null, lastCompactNote: note, phase: base.maxPings > 0 ? 'armed' : 'capped' }))
      $.ui.toast(`Compact not armed: ${note.replace(/^timed compact .*? dropped: /, '')}.`)
      await rearm($)
      return
    }
    // No pings: the cache just ages until the timer (phase stopped, as after `done`).
    await save($, () => ({ ...base, phase: 'stopped' }))
    await rearm($)
    return
  }
  await save($, () => ({ ...base, phase: base.maxPings > 0 ? 'armed' : 'capped' }))
  await rearm($)
}

function maxTimedMinutes(ttlSec: number): number {
  return Math.floor(ttlSec / 60 - config.compactLeadMinutes)
}

function isTimedTooLong(minutes: number, ttlSec: number): boolean {
  return minutes > maxTimedMinutes(ttlSec)
}

// Prompts the engine delivers as if typed. A real user prompt never starts with these.
function isEngineDelivered(text: string): boolean {
  return (
    text.startsWith('<task-notification>') ||
    text.startsWith('<command-message>') ||
    text.startsWith('Another Claude session sent a message') ||
    text.startsWith('Base directory for this skill')
  )
}

// Leaves the timed no-ping mode: back to pinging (or capped) from the state we have.
async function restorePhase($: Engine) {
  await save($, v => (v.phase === 'stopped' && v.ttlSec !== null ? { ...v, phase: v.pingsSent < v.maxPings ? 'armed' : 'capped' } : v))
  await rearm($)
}

// On session.start (a reload or a resume), $.state may already be the
// INITIAL default: a process restart does not carry it over. Arm straight
// from the transcript when it has a cache-creating row with a real
// timestamp, instead of waiting for a turn that may never come if you only
// read the status. A row with no timestamp (nothing resumed yet, e.g. a
// genuinely new session) leaves the state untouched for the next turn.
async function armFromResume($: Engine): Promise<void> {
  const s = await read($, session)
  if (s.phase === 'off' || !config.enabled) return
  const tail = await readTranscriptTail($, s.transcriptPath)
  if (!tail || tail.timestampMs === null) return
  const usage = await $.session.usage().catch(() => undefined)
  const contextTokens = usage?.context?.tokens ?? s.contextTokens
  await applyArmedState($, { lastActivityAt: tail.timestampMs, contextTokens, ttlSec: tail.ttlSec })
}

// Schedules the next ping (armed) and the expiry (armed or capped) from state.
async function rearm($: Engine) {
  cancelTimers()
  const s = await read($, session)
  if (s.ttlSec === null) return
  const now = await $.clock.now()
  const expiresAt = cacheStart(s) + s.ttlSec * 1000
  // A timed compact is the user's intent, so its time comes from timedCompactAt
  // and not from the phase: /keepalive brb adds pings (phase armed or capped)
  // but must not turn it into the pings-first mode below.
  const isTimed = s.isCompactArmed && s.compactAfterMin !== null
  if (isTimed && (s.phase === 'stopped' || s.phase === 'armed' || s.phase === 'capped')) {
    const dueAt = Math.max(timedCompactAt(s), now + MIN_TIMED_DELAY_MS)
    compactTimer = $.clock.after(Math.max(0, dueAt - now), () => {
      void compact($)
    })
  }
  // /keepalive done stops the pings but an armed compact still runs, once, in
  // the first lead window (a timed one has its own timer above).
  if (s.phase === 'stopped' && s.isCompactArmed) {
    if (!isTimed) {
      compactTimer = $.clock.after(Math.max(0, expiresAt - config.compactLeadMinutes * 60_000 - now), () => {
        void compact($)
      })
    }
    return
  }
  if (s.phase !== 'armed' && s.phase !== 'capped') return
  if (s.phase === 'armed') {
    const pingAt = expiresAt - config.leadMinutes * 60_000
    pingTimer = $.clock.after(Math.max(0, pingAt - now), () => {
      void ping($)
    })
  }
  expiryTimer = $.clock.after(Math.max(0, expiresAt - now), () => {
    void expire($)
  })
  // Pings used up: compact while the cache is still warm, so the summary
  // request reads it instead of rewriting the whole prefix.
  if (s.phase === 'capped' && !isTimed && (config.compactBeforeExpiry || s.isCompactArmed)) {
    compactTimer = $.clock.after(Math.max(0, expiresAt - config.compactLeadMinutes * 60_000 - now), () => {
      void compact($)
    })
  }
}

// Fires from the lead window, only while capped and still warm. It cannot run
// from a command (the host refuses it under the command's turn), which is why
// /keepalive compact only arms it.
async function compact($: Engine) {
  if (isCompacting) return
  const s = await read($, session)
  const isStoppedArmed = s.phase === 'stopped' && s.isCompactArmed
  // A timed compact fires in any phase that still holds a cache; the pings-first
  // one only once the pings are used up (capped) or stopped.
  const isTimedArmed = s.isCompactArmed && s.compactAfterMin !== null && s.phase === 'armed'
  if ((s.phase !== 'capped' && !isStoppedArmed && !isTimedArmed) || s.ttlSec === null) {
    // Never a silent no-op: the next miss has to be diagnosable.
    await update($, session, v => ({ ...v, lastCompactNote: `timer fired in phase ${s.phase}${s.ttlSec === null ? ', ttl unknown' : ''}: nothing done` }))
    return
  }
  if ((await $.clock.now()) >= cacheStart(s) + s.ttlSec * 1000) {
    if (s.phase !== 'stopped') await expire($) // fired late (the Mac slept): the cache is gone
    await update($, session, v => ({ ...v, isCompactArmed: false, compactAfterMin: null, lastCompactNote: 'timer fired after the cache expired (the Mac slept?): not compacted' }))
    return
  }
  const wasTimed = s.compactAfterMin !== null
  isCompacting = true
  let text: string
  let outcome = ''
  try {
    const r = await $.session.compact()
    if (r.skip !== undefined) {
      text = `Compact skipped: ${r.skip}`
      outcome = text
    } else {
      const tokens = r.tokensAfter ?? s.contextTokens
      cancelTimers()
      // The new prefix is not cached yet: nothing to keep warm until the next turn.
      await save($, v =>
        v.phase === 'armed' || v.phase === 'capped' || v.phase === 'expired' || (wasTimed && v.phase === 'stopped')
          ? { ...v, phase: 'active', contextTokens: tokens, isCompactArmed: false }
          : { ...v, contextTokens: tokens, isCompactArmed: false },
      )
      text = `Compacted before the cache expired: ${kilo(r.tokensBefore ?? s.contextTokens)} → ${kilo(tokens)} tokens.`
      outcome = text
    }
  } catch (err) {
    // A cancel or a refusal is final: no retry, the cache just expires.
    text = `Compact did not run: ${String(err).replace(/^.*?session\.compact: /, '')}`
    outcome = text
  } finally {
    isCompacting = false
  }
  await save($, v => ({ ...v, isCompactArmed: false, compactAfterMin: null, lastCompactNote: outcome }))
  $.ui.toast(text)
}

// isManual: /keepalive ping. It restarts the countdown but does not spend one
// of the automatic pings, so testing it never shortens the idle stretch.
async function ping($: Engine, isManual = false) {
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
    const pingsSent = isManual ? v.pingsSent : v.pingsSent + 1
    return { ...v, pingsSent, lastPingAt: startedAt, phase: pingsSent >= v.maxPings ? 'capped' : 'armed' }
  })
  await rearm($)
  if ((await read($, session)).phase === 'capped') await askOnTelegram($)
}

// After the engine's or the user's compaction the prefix is a fresh summary no
// request has written to the cache yet, so a ping would pay a full rewrite, read
// as a miss and turn keepalive off for good. Phase goes to active (no ping)
// until the next turn writes the new cache and re-arms. An off session stays off.
async function afterCompact($: Engine, result: { skip?: string; tokensAfter?: number }, message: string) {
  if (result.skip !== undefined) {
    await rearm($) // vetoed: nothing changed, restore the schedule
    return
  }
  const tokens = result.tokensAfter ?? (await read($, session)).contextTokens
  await closeAsk($, message)
  await save($, v => ({ ...v, phase: v.phase === 'off' ? 'off' : 'active', contextTokens: tokens, isCompactArmed: false }))
  $.ui.toast(message)
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
  const [word = 'status', value] = args.trim().split(/\s+/)
  const verb = VERB_ALIASES[word.toLowerCase()] ?? word
  const s = await read($, session)

  if (verb === 'done') {
    cancelTimers()
    if (s.phase === 'off') return paint('Keepalive is already off for this session.', 'red')
    await save($, v => ({ ...v, phase: 'stopped' }))
    await closeAsk($, '💤 Stopped with /keepalive done.')
    await rearm($) // an armed compact stays scheduled
    return s.isCompactArmed && s.ttlSec !== null
      ? `Pings stopped until your next prompt; the armed compact still runs at ${clockTime(compactAt({ ...s, phase: 'stopped' }))}.`
      : 'Keepalive stopped until your next prompt.'
  }

  if (verb === 'brb') {
    const isReset = value?.toLowerCase() === 'reset'
    const minutes = isReset ? 0 : parseDuration(value)
    if (!isReset && (!Number.isFinite(minutes) || minutes <= 0)) {
      return paint('Usage: /keepalive brb <minutes or hours> | reset, for example /keepalive brb 180, /keepalive brb 24h or /keepalive brb reset', 'red')
    }
    if (s.phase === 'off') return paint(`Keepalive is off for this session (${s.offReason}).`, 'red')
    if (s.phase === 'small') return paint('This session’s context is small enough that a rewrite is cheap; not keeping it warm.', 'yellow')
    if (s.ttlSec === null || s.phase === 'active') return paint('Nothing to keep warm yet: wait for the current turn to finish.', 'yellow')
    if (s.phase === 'expired') return paint('The cache has already expired; your next prompt rewrites it.', 'yellow')
    const intervalSec = s.ttlSec - config.leadMinutes * 60
    // reset: the configured cap again (the pings already sent stay sent).
    const maxPings = isReset ? Math.max(config.maxPings, s.pingsSent) : Math.max(s.pingsSent + 1, Math.ceil((minutes * 60) / intervalSec))
    const now = await $.clock.now()
    // With a timed compact armed, brb only says how long you are away: it adds
    // pings inside that window and moves the compact to its end, but the compact
    // stays timed. `brb reset` then goes back to the timed mode's no pings.
    const isTimed = s.isCompactArmed && s.compactAfterMin !== null
    const brbUntil = isReset ? null : now + minutes * 60_000
    await save($, v => ({ ...v, maxPings, brbUntil, phase: isTimed && isReset ? 'stopped' : v.pingsSent < maxPings ? 'armed' : 'capped' }))
    await rearm($)
    const next = Math.max(now, cacheStart(s) + s.ttlSec * 1000 - config.leadMinutes * 60_000)
    if (isReset) {
      if (isTimed) return `Back to the timed compact: no pings, compact at ${clockTime(timedCompactAt({ ...s, brbUntil: null }))}.`
      if (maxPings === 0) return 'Back to the default: no pings this idle stretch.'
      return s.pingsSent >= maxPings
        ? `Back to the default of ${pingCount(config.maxPings)}: the ${pingCount(s.pingsSent)} already sent use it up, so the cache expires at ${clockTime(cacheStart(s) + s.ttlSec * 1000)}.`
        : `Back to the default: up to ${pingCount(maxPings)} this idle stretch, next at ${clockTime(next)}.`
    }
    const model = (await $.session.model().catch(() => '')) ?? ''
    const breakEven = breakEvenPings(model)
    // Only a heads-up: pings past the break-even cost more than the one rewrite they avoid.
    const warning =
      breakEven !== null && maxPings > breakEven
        ? `\n${paint(`⚠ Past the break-even for ${model} (about ${breakEven} pings, ${Math.round((breakEven * intervalSec) / 3600)} h): the pings cost more than the one rewrite they avoid, so it only pays if you are sure to come back.`, 'yellow')}`
        : ''
    const compactNote = isTimed ? ` The armed compact runs at ${clockTime(timedCompactAt({ ...s, brbUntil }))}.` : ''
    return `Keeping the cache warm for about ${minutes} min: up to ${pingCount(maxPings)} this idle stretch, next at ${clockTime(next)}.${compactNote}${warning}`
  }

  if (verb === 'compact') {
    // Arms a one-time compact; the built-in /compact does it now. No argument or
    // minutes: no pings, compact that long after the last turn ends. `pings`:
    // keep pinging first, compact when the pings run out. Either survives turns.
    if (value === 'off') {
      cancelTimers()
      await save($, v => ({ ...v, isCompactArmed: false, compactAfterMin: null, lastCompactNote: 'disarmed with /keepalive compact off' })) // save, not update: the state file feeds the status line
      if (s.compactAfterMin !== null) await restorePhase($)
      else await rearm($)
      return 'Compact-before-expiry disarmed.'
    }
    if (s.phase === 'off') return paint(`Keepalive is off for this session (${s.offReason}).`, 'red')
    if (s.phase === 'expired') return paint('The cache has already expired; use the built-in /compact if you still want one.', 'yellow')
    if (s.phase === 'small') return paint('This session’s context is small, so it is not kept warm and nothing is compacted. To compact anyway, use the built-in /compact.', 'yellow')
    const isPings = value?.toLowerCase() === 'pings' || value?.toLowerCase() === 'p'
    const minutes = isPings ? null : value === undefined ? config.compactAfterMinutes : parseDuration(value)
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) {
      return paint('Usage: /keepalive compact [minutes|pings|off], for example /keepalive compact, /keepalive compact 45 or /keepalive compact pings', 'red')
    }
    if (minutes !== null && s.ttlSec !== null && isTimedTooLong(minutes, s.ttlSec)) {
      return paint(`Too long for a ${s.ttlSec / 60} min cache: pick at most ${maxTimedMinutes(s.ttlSec)} min, or use /keepalive compact pings (pings first, then compact).`, 'yellow')
    }
    const wasTimed = s.compactAfterMin !== null
    await save($, v => ({ ...v, isCompactArmed: true, compactAfterMin: minutes, lastCompactNote: null }))
    if (minutes === null && wasTimed) await restorePhase($)
    else if (minutes !== null && s.ttlSec !== null && s.phase !== 'active') {
      await save($, v => ({ ...v, phase: 'stopped' }))
      await rearm($)
    } else await rearm($)
    const tail = ' One time; it survives /goal turns. /keepalive compact off cancels. To compact now, use the built-in /compact.'
    const warn = `Context is ${kilo(s.contextTokens)} tokens and compacting is lossy: detail is summarised away.`
    if (minutes !== null) {
      const after = await read($, session)
      if (s.ttlSec === null || s.phase === 'active') {
        return `Armed: no pings, compact ${minutes} min after the current turn ends. ${warn}${tail}`
      }
      return `Armed: no pings, compact at about ${clockTime(compactAt(after))} (${minutes} min after the last turn). ${warn}${tail}`
    }
    if (s.ttlSec === null || s.phase === 'active') {
      return `Armed: it is scheduled when the current turn ends, after the pings run out. ${warn}${tail}`
    }
    return `Armed: compact at about ${clockTime(compactAt(s))}${s.phase === 'armed' ? ' (after the remaining pings)' : s.phase === 'stopped' ? ' (no pings, you ran /keepalive done)' : ''}. ${warn}${tail}`
  }

  if (verb === 'ping') {
    if (s.phase !== 'armed') return paint(`Nothing to ping: phase is ${s.phase}.`, 'yellow')
    await ping($, true)
    const after = await read($, session)
    if (after.lastPingAt > s.lastPingAt) return `Pinged manually: phase ${after.phase}, ${after.pingsSent}/${after.maxPings} automatic pings used.`
    if (after.phase === 'off') return paint(`Ping failed: keepalive is off (${after.offReason}).`, 'red')
    if (after.phase === 'expired') return paint('Ping skipped: the cache already expired.', 'yellow')
    return paint('Ping ran but did not count; check /keepalive status.', 'yellow')
  }

  if (verb === 'status') {
    const stats = ((await $.store.get('stats')) as Stats | undefined) ?? { pings: 0, hits: 0 }
    const lines = [
      `phase: ${paintPhase(s.phase)}${s.offReason ? ` (${s.offReason})` : ''}`,
      `ttl: ${s.ttlSec === null ? 'not read yet' : `${s.ttlSec / 60} min`}`,
      `context: ${kilo(s.contextTokens)} tokens (minimum ${kilo(config.minContextTokens)})`,
      `pings this idle stretch: ${s.pingsSent}/${s.maxPings}`,
    ]
    if (s.ttlSec !== null && (s.phase === 'armed' || s.phase === 'capped')) {
      const expiresAt = cacheStart(s) + s.ttlSec * 1000
      if (s.phase === 'armed') lines.push(`next ping: ${clockTime(expiresAt - config.leadMinutes * 60_000)}`)
      lines.push(`cache expires: ${clockTime(expiresAt)}`)
    }
    if (config.compactBeforeExpiry || s.isCompactArmed) {
      const due = compactDueAt(s)
      const at = due === null ? null : clockTime(due)
      const mode = s.isCompactArmed && s.compactAfterMin !== null ? `, timed ${s.compactAfterMin} min, no pings` : ''
      lines.push(`compact before expiry: ${s.isCompactArmed ? 'armed' : 'on'}${mode}${at ? `, at ${at}` : ''}`)
    } else {
      lines.push('compact before expiry: off')
    }
    if (s.lastCompactNote) lines.push(`last compact note: ${s.lastCompactNote}`)
    lines.push(`telegram: ${isTelegramOn() ? `on (chat ${config.telegramChatId}${s.tgAskMessageId !== null ? ', question open' : ''})` : 'off'}`)
    lines.push(`all sessions: ${stats.pings} pings, ${stats.hits} hits`)
    return lines.join('\n')
  }

  return paint('Usage: /keepalive done | brb <minutes|hours|reset> | compact [minutes|pings|off] | ping | status (d = done, c = compact, p = ping, s = status)', 'red')
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
    ...(config.compactBeforeExpiry || s.isCompactArmed
      ? [`Will compact at ${clockTime(compactAt(s))} unless you keep it warm.`]
      : []),
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
    // Armed by /keepalive compact, and the epoch ms it is due (null while
    // nothing is scheduled, e.g. during a turn): the status line shows both.
    compactArmed: s.isCompactArmed,
    compactAt: compactDueAt(s),
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
      return config.compactBeforeExpiry || s.isCompactArmed
        ? `keep ${s.pingsSent}/${s.maxPings} ⏸ · compact ${clockTime(compactAt(s))}`
        : `keep ${s.pingsSent}/${s.maxPings} ⏸ · expires ${clockTime(expiresAt)}`
    case 'stopped':
      return s.isCompactArmed ? `keep ⏸ · compact ${clockTime(compactAt(s))}` : `keep ⏸ · expires ${clockTime(expiresAt)}`
    case 'expired':
      return 'cache expired'
    case 'off':
      return s.offReason === 'disabled' ? undefined : `keep off · ${s.offReason}`
    default:
      return undefined // active, small
  }
}

type TtlLine = { ttlSec: number; timestampMs: number | null }

// The TTL is not in the turn's usage; the transcript's assistant rows carry
// the 1h/5m split (and, when present, a real `timestamp` for when that row
// was written — used to arm a resumed session with the cache's real age
// instead of assuming it just started). The latest row that wrote to the
// cache decides, so a row not yet flushed when turn.complete fires costs
// nothing.
async function readTranscriptTail($: Engine, transcriptPath: string | null): Promise<TtlLine | null> {
  if (!transcriptPath) return null
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), transcriptPath]).catch(() => undefined)
  if (!r || r.exitCode !== 0) return null
  const lines = r.stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const info = ttlLineInfo(lines[i] ?? '')
    if (info) return info
  }
  return null
}

async function readTtl($: Engine, transcriptPath: string | null): Promise<number | null> {
  return (await readTranscriptTail($, transcriptPath))?.ttlSec ?? null
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

const ANSI = { red: '31', green: '32', yellow: '33', dim: '2' } as const
function paint(text: string, colour: keyof typeof ANSI): string {
  return isTerminal ? `\u001b[${ANSI[colour]}m${text}\u001b[0m` : text
}

// armed is working, capped has run out of pings, expired and off need your attention.
function paintPhase(phase: KeepaliveSession['phase']): string {
  const colour = { armed: 'green', capped: 'yellow', expired: 'red', off: 'red', stopped: 'dim' } as const
  return phase in colour ? paint(phase, colour[phase as keyof typeof colour]) : phase
}

function pingCount(n: number): string {
  return `${n} ${n === 1 ? 'ping' : 'pings'}`
}

// "180" and "180m" are minutes, "24h" is hours (the Telegram answer takes both too).
function parseDuration(value: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)([hm])?$/i.exec(value ?? '')
  if (!m) return NaN
  return m[2]?.toLowerCase() === 'h' ? Number(m[1]) * 60 : Number(m[1])
}

function brbCompletion(text: string, cursor: number): string {
  if (cursor !== text.length) return ''
  const m = /^\/keepalive\s+brb\s+(\d*)$/.exec(text)
  if (!m) return ''
  const typed = m[1] ?? ''
  const preset = BRB_PRESETS.find(p => p.startsWith(typed) && p.length > typed.length)
  return preset ? preset.slice(typed.length) : ''
}

function ttlLineInfo(line: string): TtlLine | null {
  if (!line.includes('ephemeral_')) return null
  try {
    const entry = JSON.parse(line)
    if (entry.type !== 'assistant' || entry.isSidechain === true) return null
    const split = entry.message?.usage?.cache_creation
    if (!split) return null
    const ttlSec = (split.ephemeral_5m_input_tokens ?? 0) > 0 ? TTL_5M : (split.ephemeral_1h_input_tokens ?? 0) > 0 ? TTL_1H : null
    if (ttlSec === null) return null
    const parsedTs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    return { ttlSec, timestampMs: Number.isFinite(parsedTs) ? parsedTs : null }
  } catch {
    return null // the tail's first line is usually cut mid-row
  }
}

function stateFile(): string {
  return `${stateDir}/${sessionId}.json`
}

// When the armed compact fires: compactLeadMinutes before the cache would
// expire after the last ping, longer ahead than a ping because a compaction
// takes minutes on a big context. Every ping moves the cache start one
// interval (TTL minus lead) on.
function compactAt(s: KeepaliveSession): number {
  if (s.compactAfterMin !== null) return timedCompactAt(s)
  const ttl = s.ttlSec ?? TTL_1H
  const intervalMs = (ttl - config.leadMinutes * 60) * 1000
  const pingsLeft = s.phase === 'armed' ? Math.max(0, s.maxPings - s.pingsSent) : 0
  return cacheStart(s) + pingsLeft * intervalMs + (ttl - config.compactLeadMinutes * 60) * 1000
}

// When a timed compact fires: N minutes after the last turn ended, or at the end
// of the brb window if that is later. It reads no phase, so adding pings (brb)
// or stopping them (done) never moves it. The last turn, not the last ping,
// starts the idle clock: a ping restarts the cache, not the idleness.
function timedCompactAt(s: KeepaliveSession): number {
  return Math.max(s.lastActivityAt + (s.compactAfterMin ?? 0) * 60_000, s.brbUntil ?? 0)
}

// When a compact is scheduled for this state, or null: the status line and
// /keepalive status show it. The option applies to every idle stretch; the
// flag only to the one it was armed for, and it also survives /keepalive done.
function compactDueAt(s: KeepaliveSession): number | null {
  if (s.ttlSec === null) return null
  const isOn = s.isCompactArmed || config.compactBeforeExpiry
  const isScheduled = s.phase === 'capped' || s.phase === 'armed' || (s.phase === 'stopped' && s.isCompactArmed)
  return isOn && isScheduled ? compactAt(s) : null
}

function cacheStart(s: KeepaliveSession): number {
  return Math.max(s.lastActivityAt, s.lastPingAt)
}

function cancelTimers() {
  // The Telegram poller is separate: a question stays open across re-arms.
  pingTimer?.cancel()
  expiryTimer?.cancel()
  compactTimer?.cancel()
  pingTimer = undefined
  expiryTimer = undefined
  compactTimer = undefined
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
