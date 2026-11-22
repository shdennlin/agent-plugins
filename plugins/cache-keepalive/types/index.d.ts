export type KeepalivePhase =
  | 'active' // a turn is running, or no idle stretch is being kept
  | 'small' // context under minContextTokens: not kept
  | 'armed' // a ping is scheduled
  | 'capped' // pings used up; the cache expires on its own
  | 'stopped' // /keepalive done
  | 'expired' // the cache TTL ran out while idle
  | 'off' // disabled for the rest of the session (offReason says why)

export type KeepaliveOffReason = '5m-ttl' | 'ttl-mismatch' | 'api-error' | 'disabled'

export type KeepaliveSession = {
  phase: KeepalivePhase
  offReason: KeepaliveOffReason | null
  /** Epoch ms of the last main-thread response. */
  lastActivityAt: number
  /** Epoch ms of the last ping that hit, or 0. */
  lastPingAt: number
  pingsSent: number
  maxPings: number
  /** Cache TTL in seconds read from the transcript, or null until read. */
  ttlSec: number | null
  /** Input tokens of the last main-thread response (the cached prefix). */
  contextTokens: number
  transcriptPath: string | null
  /** The expired band was dismissed for this idle stretch. */
  isBandDismissed: boolean
  /** The OFF toast was already shown this session. */
  isOffToastShown: boolean
  /** message_id of the open Telegram question, or null when none is open. */
  tgAskMessageId: number | null
  /** /keepalive compact: armed for the whole session, every idle stretch compacts. Survives turns, typed prompts and a compact firing; cleared only by `compact off` (or a timed N too long for the TTL). */
  isCompactArmed: boolean
  /** /keepalive compact [minutes]: compact this many minutes after the last turn ends (null: the compactAfterMinutes default). Persists with the flag; a later bare `compact` keeps it. */
  compactAfterMin: number | null
  /** /keepalive brb: epoch ms the user said they are away until, or null. With a timed compact it only moves the compact later (to this time, if past last turn + N); it never switches the compact to the pings-first mode. Survives the engine's own turns (a monitor event, a /goal step); cleared by a prompt you type, by `brb reset`, and once it has passed. */
  brbUntil: number | null
  /** `/keepalive compact off` was run: the compactBeforeExpiry option (the session's starting value) must not re-arm it. Cleared by the next `compact`. */
  isCompactOff: boolean
  /** Monitors and shells still running at the last turn end (from the Stop hook's background_tasks); subagents and workflows are not counted. */
  bgTasks: number
  /** The armed compact's "a background task is still running" warning was shown; reset when the tasks end, a compact fires or you type a prompt. */
  isBgWarned: boolean
  /** Why the last armed compact ended (ran, skipped, refused, cancelled by a prompt), so a miss can be diagnosed afterwards. */
  lastCompactNote: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keepalive': { session: KeepaliveSession }
  }
}
