# cache-keepalive

Keeps the main thread's prompt cache warm while you are away. About five minutes before the cache TTL runs out, it sends one tool-less fork of the conversation (`$.model.fork`) that re-reads the cached prefix and restarts the TTL. The ping never lands in the transcript, so nothing needs rewinding.

By default it pings at most twice per idle stretch, so a lunch or a meeting comes back to a warm cache. Every ping is verified: if the fork does not read the prefix from cache, keepalive turns itself off for the session.

Requires **Claude Code 2.1.289** or later (hook-module plugin API). The status widget targets **ccstatusline 2.2.30**.

## Quick setup

Nothing is required: once the plugin loads, it keeps the cache warm. The rest is optional.

| You want | Set up | |
|---|---|---|
| Keepalive itself | Load the plugin (below) | required |
| The state always on screen | A status line field and a refresh interval ([docs/status-line.md](docs/status-line.md)) | optional; `/keepalive status` works without it |
| A Telegram question once the pings run out | Bot token **and** `telegramChatId` ([docs/telegram.md](docs/telegram.md)) | optional; both are needed, or nothing is sent |
| Only your own answers to count | `telegramUserId` | optional; without it anyone in the chat can answer |

Load the plugin, one of:

```bash
# every session: add the folder to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json ("env" block),
# separated by ":" from any folders already listed
"CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/plugins/cache-keepalive"

# one session only
claude --plugin-dir /absolute/path/to/plugins/cache-keepalive
```

Then set options with `/plugin configure cache-keepalive` (sensitive ones included) or `/config` (search for `keep`). A session started with `--plugin-dir` reads them from `pluginConfigs["cache-keepalive"].options` in settings.

Check it: `/keepalive status` shows the phase, the TTL it read, and `telegram: on` when Telegram is set up.

## Commands

| Command | What it does |
|---|---|
| `/keepalive status` | Phase, TTL, context size, pings so far, next ping and expiry times |
| `/keepalive brb <minutes or hours>` | Keep warm for longer this idle stretch, e.g. `brb 180` allows 4 pings and `brb 24h` 27. Resets at your next prompt |
| `/keepalive brb reset` | Back to the configured `maxPings` for this idle stretch. Pings already sent are not taken back |
| `/keepalive done` | Stop pinging for this idle stretch. Resets at your next prompt |
| `/keepalive compact` | Arm a one-time compact for when keepalive runs out ([below](#compact-before-expiry)). `compact off` cancels |

In a terminal the replies are coloured (a past-break-even warning in yellow, errors in red, the phase in `status` by state); other surfaces get plain text. Typing `/keepalive brb ` offers `180` as a dim completion; Right arrow accepts. When you come back to an expired cache, a one-line band above the prompt says how much the next request will rewrite; your next prompt or Dismiss clears it.

## Options

Set in `/config` (or `pluginConfigs["cache-keepalive"].options` in settings):

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Master switch |
| `leadMinutes` | `5` | Ping this many minutes before the TTL runs out |
| `maxPings` | `2` | Pings per idle stretch |
| `minContextTokens` | `50000` | Smaller contexts are not kept warm |
| `compactLeadMinutes` | `10` | An armed compact starts this many minutes before the TTL runs out |
| `compactBeforeExpiry` | `false` | Compact in that window every idle stretch, without arming each time |
| `engineStatus` | `false` | Show the state as a status entry under the prompt, for sessions without a status line |
| `telegramBotToken` | empty | Bot token (sensitive); see [Telegram](docs/telegram.md) |
| `telegramChatId` | empty | Chat that receives the question |
| `telegramUserId` | empty | Only this user's answers count |

## Compact before expiry

Run `/keepalive compact` before you leave, or before a `/goal` you will not watch. Keepalive pings as usual; once the pings run out, it compacts the conversation `compactLeadMinutes` (10) before the cache expires, while it is still warm. The summary request reads the cache instead of rewriting the whole prefix (98% of a 142k prefix read from cache, measured once), and your next prompt rewrites a small summary instead of the old context.

- **One time.** It clears when it fires, with `/keepalive compact off`, or when you type a plain prompt (a toast says so). A slash command or a `/goal` continuation does not clear it.
- `/keepalive done` skips the pings: the compact then runs about 50 minutes after the last turn on a 1h TTL. `maxPings: 0` does the same for a `/goal`, which `done` would not survive.
- A late timer (the Mac slept), a cancelled compaction or a ping that misses the cache means no compact; the cache just expires.

Flow chart, timeline and the edge cases: [docs/compact.md](docs/compact.md).

## Cost

A ping re-reads the cached prefix at the cache-read price, a small fraction of one rewrite. The default two pings cost about 5% of a rewrite on Opus 5.5 (2.5% on Fable 5.1, 10% on Sonnet 5.5), so keeping warm pays off if you are even slightly likely to come back. Past the break-even (20 pings, about 18 h, on most models; 40 and 37 h on Opus 5.5; 80 and 73 h on Fable 5.1) the pings cost more than the one rewrite they avoid. Sessions under 50k tokens are not kept warm, and a 5-minute TTL turns keepalive off. Prices and the arithmetic: [docs/cost.md](docs/cost.md).

## Telegram (optional)

When the pings run out while you are away, keepalive can ask on Telegram whether to keep going: `+1h`, `+3h`, or let it expire, by button or by replying with minutes (`120`, `2h`). It needs a bot token and a chat id. Setup: [docs/telegram.md](docs/telegram.md).

## Seeing the state

Keepalive works without a status line: `/keepalive status`, the expired band and a toast when it turns itself off. For an always-visible state, `bin/keepalive-cache` is a drop-in for ccstatusline's Cache Timer, or a status line command of its own:

```
🟢58:54 kp 1/2 ✂03:12
```

The countdown, `kp used/cap` and `✂` (an armed compact, with the time it is due) are explained in [docs/status-line.md](docs/status-line.md), with the ccstatusline setup and the `engineStatus` option for sessions with no status line. Set `statusLine.refreshInterval` (30 seconds is enough), or the field only redraws on events.

## Limits

- No pings while the Mac sleeps: the process is asleep too. A timer that fires after the cache already expired skips the ping.
- A turn that ends in an `error` or `refusal` reads no usage and runs no pings, but an armed compact is still scheduled from the last good response, so a `/goal` that dies on an API error does not lose it.
- A turn waiting on a permission prompt has not finished, so no ping is scheduled during it.
- After a prefix change (`/model`, a plugin reload that changes the system prompt or tools) the next ping misses once, and keepalive turns off for the session.

## More

| | |
|---|---|
| [docs/cost.md](docs/cost.md) | Prices per model, ping vs rewrite, break-even |
| [docs/compact.md](docs/compact.md) | Flow chart, timeline and edge cases of the armed compact |
| [docs/telegram.md](docs/telegram.md) | The Telegram question and its setup |
| [docs/status-line.md](docs/status-line.md) | ccstatusline, your own status line, `engineStatus` |
| [docs/PRD.md](docs/PRD.md) | Design, decisions and their evidence |

## Development

```bash
claude plugin validate plugins/cache-keepalive
claude --plugin-dir plugins/cache-keepalive   # once, so the engine lays .claude-plugin/types/ for tsc
tsc -p plugins/cache-keepalive
claude plugin test plugins/cache-keepalive    # hook tests (tests/*.test.ts)
node --test plugins/cache-keepalive/tests/widget.test.cjs   # status widget tests
```
