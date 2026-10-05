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
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keepalive': { session: KeepaliveSession }
  }
}
