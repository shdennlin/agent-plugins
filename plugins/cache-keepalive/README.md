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
| `/keepalive brb <minutes or hours>` | Say how long you are away: pings keep the cache warm until then (`brb 180` allows 4 pings, `brb 24h` 29; with a compact armed only the pings that come before the compact, so 3 and 28) and the compact moves to the end of that window. A monitor event or a `/goal` step does not end it; the next prompt you type does |
| `/keepalive brb reset` | End the brb: back to the configured `maxPings` (or, with a compact armed, to no pings and the compact N minutes after the last turn). Pings already sent are not taken back |
| `/keepalive c` / `p` / `s` | Short forms of `compact`, `ping` and `status` |
| `/keepalive compact [minutes]` | Arm a compact for the whole session: `compactAfterMinutes` (50) or the given minutes after the last turn ends, every idle stretch, until `compact off`. The minutes are kept; a bare `compact` keeps them too ([below](#compact-before-expiry)) |
| `/keepalive compact off` | Disarm it (also for the `compactBeforeExpiry` option, for this session) |
| `/keepalive ping` | Fire a ping immediately and restart the countdown; it does not use up the automatic pings. Refused unless `armed` |

In a terminal the replies are coloured (a past-break-even warning in yellow, errors in red, the phase in `status` by state); other surfaces get plain text. Typing `/keepalive brb ` offers `180` as a dim completion; Right arrow accepts. When you come back to an expired cache, a one-line band above the prompt says how much the next request will rewrite; your next prompt or Dismiss clears it.

## Options

Set in `/config` (or `pluginConfigs["cache-keepalive"].options` in settings):

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Master switch |
| `leadMinutes` | `10` | Ping this many minutes before the TTL runs out |
| `maxPings` | `2` | Pings per idle stretch |
| `minContextTokens` | `50000` | Smaller contexts are not kept warm |
| `compactLeadMinutes` | `10` | An armed compact starts this many minutes before the TTL runs out |
| `compactAfterMinutes` | `50` | What a bare `/keepalive compact` waits after the last turn (at most the TTL minus `compactLeadMinutes`) |
| `compactBeforeExpiry` | `false` | Start every session with the compact armed (as `/keepalive compact` does); `compact off` turns it off for that session |
| `engineStatus` | `false` | Show the state as a status entry under the prompt, for sessions without a status line |
| `telegramBotToken` | empty | Bot token (sensitive); see [Telegram](docs/telegram.md) |
| `telegramChatId` | empty | Chat that receives the question |
| `telegramUserId` | empty | Only this user's answers count |

## Compact before expiry

Compacting is lossy: the summary drops detail, so nothing compacts unless you arm it, and the reply states the context size when you do. `/keepalive compact` (or `/keepalive compact 45`) arms it **for the session**: that many minutes after the last turn ends, while the cache is still warm, it compacts, and it does so again in every later idle stretch until `/keepalive compact off`. Every new turn (a `/goal` step, a monitor event) restarts the countdown. The summary request reads the cache instead of rewriting the whole prefix (98% of a 142k prefix read from cache, measured once), and your next prompt rewrites a small summary instead of the old context.

- **Permanent until `off`.** A prompt you type, a `/goal` continuation, a monitor's notification, a skipped, refused or late compaction: none of them disarms it. After a compact the context is small, so it compacts again only once the context has grown back past `minContextTokens`. Every compact ends with a toast saying it is still armed, and the status line shows `✂` all the time. `/keepalive status` shows `last compact note`. It lasts for this session only.
- **`brb` cooperates.** `/keepalive brb 180` says you are away for three hours: pings keep the cache warm, and the compact moves from N minutes to the end of that window (while the cache is still warm). A monitor event or a `/goal` step does not end the `brb`; the next prompt you type does. Without a `brb`, a running monitor or shell does not hold the compact back: keepalive warns once (a toast and `⚠bg` in the status line) and compacts at N anyway.
- Aliases: `/keepalive c` is `compact`, `p` is `ping`, `s` is `status`. `compact pings` and `done` were removed in 0.8.0 (use `brb`, or `maxPings: 0`).
- A late timer (the Mac slept), a cancelled compaction or a ping that misses the cache means no compact in that stretch; the cache just expires and it is still armed for the next one.

Flow chart, timeline and the edge cases: [docs/compact.md](docs/compact.md).

**Claude Code (v2.1.290+, per its docs) can also compact idle sessions on its own**: a conversation at 200k context tokens or more (`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, at least 100k) left idle for "about an hour". The docs give no exact minutes. Whether it is on depends on `idleCompaction` (default `true`), on `autoCompactEnabled` (a toggle in `/config` that the settings docs do not describe) and on a server-side flag, so keepalive cannot know. It does not need to: it detects the compaction (it is not a turn, so `turn.complete` never fires) and resets its own state instead of pinging a prefix that no longer exists, and the default 50 minutes comes before an hour anyway. The same goes for your own `/compact`: the summary is not cached until the next turn, so keepalive stops pinging (phase `active`) and re-arms after that turn. If you want pings to preserve the full context instead of letting the engine summarize it, set `"idleCompaction": false` in settings.json or raise `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`.

## Cost

A ping re-reads the cached prefix at the cache-read price, a small fraction of one rewrite. The default two pings cost about 5% of a rewrite on Opus 5.5 (2.5% on Fable 5.1, 10% on Sonnet 5.5), so keeping warm pays off if you are even slightly likely to come back. Past the break-even (20 pings, about 17 h, on most models; 40 and 33 h on Opus 5.5; 80 and 67 h on Fable 5.1) the pings cost more than the one rewrite they avoid. Sessions under 50k tokens are not kept warm, and a 5-minute TTL turns keepalive off. Prices and the arithmetic: [docs/cost.md](docs/cost.md).

## Telegram (optional)

When the pings run out while you are away, keepalive can ask on Telegram whether to keep going: `+1h`, `+3h`, or let it expire, by button or by replying with minutes (`120`, `2h`). It needs a bot token and a chat id. Setup: [docs/telegram.md](docs/telegram.md).

## Seeing the state

Keepalive works without a status line: `/keepalive status`, the expired band and a toast when it turns itself off. For an always-visible state, `bin/keepalive-cache` is a drop-in for ccstatusline's Cache Timer, or a status line command of its own:

```
58:54 kp 1/2 ✂03:12
```

The countdown, `kp used/cap` and `✂` (an armed compact, with the time it is due) are explained in [docs/status-line.md](docs/status-line.md), with the ccstatusline setup and the `engineStatus` option for sessions with no status line. Set `statusLine.refreshInterval` (30 seconds is enough), or the field only redraws on events.

## Limits

- No pings while the Mac sleeps: the process is asleep too. A timer that fires after the cache already expired skips the ping.
- A resumed session (`claude -r`/`--continue`) arms itself right at `session.start` from the transcript'''s last cache-creating row, using that row'''s real write time rather than the moment you resumed — so a cache that actually expired while you were away shows `expired`, not a fresh 2-ping window.
- A turn that ends in an `error` or `refusal` reads no usage and runs no pings, but an armed compact is still scheduled from the last good response, so a `/goal` that dies on an API error does not lose it.
- A turn waiting on a permission prompt has not finished, so no ping is scheduled during it.
- After a prefix change (`/model`, a plugin reload that changes the system prompt or tools) the next ping misses once, and keepalive turns off for the session.

## More

| | |
|---|---|
| [docs/cost.md](docs/cost.md) | Prices per model, ping vs rewrite, break-even |
| [docs/compact.md](docs/compact.md) | The armed compact and `brb`, flow chart, timeline and edge cases |
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
