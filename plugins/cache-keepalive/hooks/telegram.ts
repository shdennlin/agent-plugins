// Telegram message building and update parsing for the keepalive question.
// Pure functions: no `$`, so register.tsx owns every call to the Bot API.

export type TelegramTarget = {
  chatId: string
  /** Only this user's presses and replies count; empty accepts anyone in the chat. */
  userId: string
  /** The message that carries the question. */
  messageId: number
  /** First 8 characters of the session id, carried in callback_data. */
  sessionTag: string
}

/** What the person answered: minutes to keep warm, 0 to let the cache expire. */
export type TelegramAnswer = {
  updateId: number
  minutes: number
  callbackId?: string
}

const PREFIX = 'ka'
export const CHOICES = [
  { label: '+1h', minutes: 60 },
  { label: '+3h', minutes: 180 },
  { label: 'Let it expire', minutes: 0 },
] as const

export function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Same header as session-notifier: bold project, italic session title. */
export function header(project: string, title: string | null): string {
  const head = `<b>${htmlEscape(project)}</b>`
  return title ? `${head} · <i>${htmlEscape(title)}</i>` : head
}

export function keyboard(sessionTag: string) {
  return {
    inline_keyboard: [
      CHOICES.map(c => ({ text: c.label, callback_data: `${PREFIX}:${sessionTag}:${c.minutes}` })),
    ],
  }
}

/**
 * Reads one getUpdates entry. Answers only a button press on the question
 * message, or a text reply to it, from the configured chat and user.
 */
export function parseUpdate(update: unknown, target: TelegramTarget): TelegramAnswer | null {
  const u = update as {
    update_id?: number
    callback_query?: {
      id?: string
      data?: string
      from?: { id?: number }
      message?: { message_id?: number; chat?: { id?: number } }
    }
    message?: {
      text?: string
      from?: { id?: number }
      chat?: { id?: number }
      reply_to_message?: { message_id?: number }
    }
  }
  if (typeof u?.update_id !== 'number') return null

  const cb = u.callback_query
  if (cb) {
    if (!isTarget(cb.message?.chat?.id, cb.from?.id, cb.message?.message_id, target)) return null
    const m = new RegExp(`^${PREFIX}:([^:]+):(\\d+)$`).exec(cb.data ?? '')
    if (!m || m[1] !== target.sessionTag) return null
    return { updateId: u.update_id, minutes: Number(m[2]), callbackId: cb.id }
  }

  const msg = u.message
  if (msg) {
    if (!isTarget(msg.chat?.id, msg.from?.id, msg.reply_to_message?.message_id, target)) return null
    const minutes = minutesFromText(msg.text ?? '')
    return minutes === null ? null : { updateId: u.update_id, minutes }
  }
  return null
}

/** "120", "+90", "2h", "+1.5h", "45m", "stop" → minutes; anything else → null. */
export function minutesFromText(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (/^(stop|expire|no|0)$/.test(t)) return 0
  const m = /^\+?\s*(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins|minutes?)?$/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  const minutes = m[2]?.startsWith('h') ? n * 60 : n
  return minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : null
}

function isTarget(chatId: number | undefined, fromId: number | undefined, messageId: number | undefined, target: TelegramTarget): boolean {
  if (String(chatId) !== target.chatId) return false
  if (target.userId && String(fromId) !== target.userId) return false
  return messageId === target.messageId
}
