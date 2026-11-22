# cache-keepalive

Keeps Claude Code's prompt cache warm while you are away, so coming back to a session does not re-pay for the whole context.

About ten minutes before the 1-hour cache expires, it sends one tiny background request that re-reads the cache and restarts the timer. It never appears in your transcript, and every ping is checked: if the cache was not hit, keepalive turns itself off for the session.

Requires **Claude Code 2.1.289** or later. The status widget targets **ccstatusline 2.2.30**.

## Using it

**Most of the time: nothing.** A lunch or a meeting comes back to a warm cache (up to 2 pings per idle stretch).

**Away for hours: `/keepalive brb 3h`.** Keeps the cache warm for that long (one ping every 50 minutes). It ends when you type a prompt.

**A session you leave running (an agent, a build, a `/goal`): `/keepalive compact`.** After 50 minutes idle it compacts the context, and it does so again every idle stretch until you run `/keepalive compact off`. Compacting is lossy, but it reads the warm cache, so it is cheap and your next prompt rewrites a small summary instead of the whole context.

**Both: `compact` and `brb 3h`.** The full context stays warm for three hours, then it compacts.

`/keepalive status` shows what it is doing. More on `brb` and `compact`: [docs/compact.md](docs/compact.md).

## Commands

| Command | What it does |
|---|---|
| `/keepalive brb <time>` | You are away for `<time>` (`90`, `3h`, `24h`): pings until then. A monitor event or a `/goal` step does not end it; your next typed prompt does |
| `/keepalive brb reset` | End it |
| `/keepalive compact [minutes]` | Arm the compact for this session: `minutes` (default 50) after the last turn, every idle stretch |
| `/keepalive compact off` | Disarm it |
| `/keepalive ping` | Ping now (refused unless armed, and during a compaction) |
| `/keepalive status` | Phase, pings, expiry, the compact, the `brb`, background tasks |

Short forms: `c` is `compact`, `p` is `ping`, `s` is `status`. Typing `/keepalive brb ` offers `180` as a dim completion (Right arrow accepts).

## Install

Nothing else is required: once the plugin loads, it works.

```bash
# every session: add the folder to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json ("env" block),
# separated by ":" from any folders already listed
"CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/plugins/cache-keepalive"

# one session only
claude --plugin-dir /absolute/path/to/plugins/cache-keepalive
```

Options: `/plugin configure cache-keepalive` or `/config` (search for `keep`). With `--plugin-dir`, set them under `pluginConfigs["cache-keepalive"].options` in settings.

## Seeing the state

`/keepalive status` always works. For a line that is always on screen, use `bin/keepalive-cache` as a status line field:

```
58:54 kp 1/2 ✂19:42 brb→21:30 ⚠bg
```

(cache countdown, pings used / cap, the compact's time, the `brb` deadline, a background task still running). Set `statusLine.refreshInterval` to 30 or the field only redraws on events. Setup for ccstatusline, your own script, or no status line: [docs/status-line.md](docs/status-line.md).

## Options

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Master switch |
| `maxPings` | `2` | Pings per idle stretch |
| `compactAfterMinutes` | `50` | What a bare `/keepalive compact` waits (at most the TTL minus `compactLeadMinutes`) |
| `compactBeforeExpiry` | `false` | Start every session with the compact armed |
| `minContextTokens` | `50000` | Smaller contexts are not kept warm |
| `leadMinutes` | `10` | Ping this long before the TTL runs out |
| `compactLeadMinutes` | `10` | How long before expiry a compact may start |
| `engineStatus` | `false` | Show the state under the prompt (for sessions with no status line) |
| `telegramBotToken`, `telegramChatId`, `telegramUserId` | empty | Ask on Telegram when the pings run out: [docs/telegram.md](docs/telegram.md) |

## Good to know

- A ping costs a few percent of one rewrite: [docs/cost.md](docs/cost.md). Sessions under 50k tokens and 5-minute caches are not kept warm.
- No pings while the Mac sleeps. A resumed session arms from its transcript's real cache age.
- Claude Code can also compact idle sessions on its own (about an hour, at 200k+ tokens); keepalive notices and resets itself.
- Coming back to an expired cache, a one-line band says how much the next request rewrites.

## Upgrading to 0.8.0

`compact pings` and `done` are removed (use `brb`; `maxPings: 0` stops the pings). The compact is now permanent for the session until `compact off`. Defaults moved: `leadMinutes` 10 and `compactAfterMinutes` 50. A `brb` now survives monitor events.

## More

| | |
|---|---|
| [docs/compact.md](docs/compact.md) | `brb` and `compact` in detail |
| [docs/status-line.md](docs/status-line.md) | Status line setup |
| [docs/telegram.md](docs/telegram.md) | The Telegram question |
| [docs/cost.md](docs/cost.md) | Prices and break-even |
| [docs/design.md](docs/design.md) | Why it works this way, and what was measured |

## Development

```bash
claude plugin validate plugins/cache-keepalive
claude plugin test plugins/cache-keepalive                  # hook tests
node --test plugins/cache-keepalive/tests/widget.test.cjs   # status widget tests
```
