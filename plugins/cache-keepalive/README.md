# cache-keepalive

Keeps the main thread's prompt cache warm while you are away. About five minutes before the cache TTL runs out, it sends one tool-less fork of the conversation (`$.model.fork`) that re-reads the cached prefix and restarts the TTL. The ping never lands in the transcript, so nothing needs rewinding.

By default it pings at most twice per idle stretch, so a lunch or a meeting comes back to a warm cache. Every ping is verified: if the fork does not read the prefix from cache, keepalive turns itself off for the session.

Requires **Claude Code 2.1.289** or later (hook-module plugin API). The status widget targets **ccstatusline 2.2.30**.

## Quick setup

Nothing is required: once the plugin loads, it keeps the cache warm. The rest is optional.

| You want | Set up | |
|---|---|---|
| Keepalive itself | Load the plugin (below) | required |
| The state always on screen | A status line field and a refresh interval ([Seeing the state](#seeing-the-state)) | optional; `/keepalive status` works without it |
| A Telegram question once the pings run out | Bot token **and** `telegramChatId` ([Telegram](#telegram-optional)) | optional; both are needed, or nothing is sent |
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

## Cost

A ping is not free: it re-reads the whole prefix at the cache-read rate (0.1×). With a 200k context and the 1h TTL:

| | Base-input equivalent |
|---|---|
| Rewrite after the cache expired (2× write) | 400k |
| One ping | 20k |
| Default cap, 2 pings | 40k |

Sessions under 50k tokens of context are not kept warm, since a rewrite is cheap there. A **5-minute TTL** turns keepalive off: about 13 pings an hour at 0.1× is 1.3×, more than one 1.25× rewrite.

The TTL is read, not assumed: the turn's `usage` has no 1h/5m split, so the plugin reads `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` from the transcript tail.

## Commands

| Command | What it does |
|---|---|
| `/keepalive status` | Phase, TTL, context size, pings so far, next ping and expiry times |
| `/keepalive brb <minutes>` | Keep warm for longer this idle stretch, e.g. `brb 180` allows 4 pings. Resets at your next prompt |
| `/keepalive done` | Stop for this idle stretch. Resets at your next prompt |

Typing `/keepalive brb ` completes the minutes inline, fish-style: a dim `180` appears, and typing `4` or `6` turns it into `480` or `60`. Right arrow accepts; Enter runs what the box shows, completion included. Tab and Up/Down are kept by the editor and never reach the plugin, so there is no cycling. Pasting or very fast typing can outrun the completion: the next key may land before the dim tail is drawn.

When you come back to an expired cache, a one-line band above the prompt says how much the next request will rewrite. It disappears when you send a prompt or press Dismiss.

## Options

Set in `/config` (or `pluginConfigs["cache-keepalive"].options` in settings):

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Master switch |
| `leadMinutes` | `5` | Ping this many minutes before the TTL runs out |
| `maxPings` | `2` | Pings per idle stretch |
| `minContextTokens` | `50000` | Smaller contexts are not kept warm |
| `engineStatus` | `false` | Show the state as a status entry under the prompt, for sessions without a status line (see below) |
| `telegramBotToken` | empty | Bot token (sensitive); see Telegram below |
| `telegramChatId` | empty | Chat that receives the question |
| `telegramUserId` | empty | Only this user's answers count |

## Telegram (optional)

When the pings run out while you are away, keepalive can ask on Telegram:

```
myproject · refactor-auth
🧊 Cache expires at 01:12 · 180k context
Rewrite ≈ 360k · one more hour warm ≈ 18k
Tap a button, or reply with minutes (e.g. 120).
[+1h] [+3h] [Let it expire]
```

`+1h` adds one ping (55 minutes on a 1h TTL), `+3h` three. A text reply to the message works too: `120`, `2h`, `45m`, `stop`. Once answered, or when you come back, the cache expires, or you run `/keepalive done`, the message shows the outcome and loses its buttons.

Setup:

1. Use any bot you own, including the one session-notifier posts with. Its privacy mode must be on (the default; `getMe` reports `can_read_all_group_messages: false`) and it must have no webhook (`getWebhookInfo` url empty).
2. Store the token, in one of three places (checked in this order):
   - **The `telegramBotToken` option.** Set it with `/plugin configure cache-keepalive` inside Claude Code: a sensitive option, kept in secure storage rather than `settings.json`. Best once the plugin is installed from a marketplace. (`claude plugin install … --config telegramBotToken=…` works too, but leaves the token in your shell history.)
   - **The `CLAUDE_KEEPALIVE_TELEGRAM_BOT_TOKEN` environment variable.** Avoid it outside CI: it sits in plain text in a settings or profile file, and every process Claude Code starts inherits it, so one `env` run by the model puts the token in the transcript.
   - **The macOS Keychain.** Encrypted, in no file and no environment. The plugin reads it once per session. Best while loading the plugin with `--plugin-dir`:
     ```bash
     security add-generic-password -s claude-code.cache-keepalive -a telegram-bot-token -w   # prompts for the token
     security delete-generic-password -s claude-code.cache-keepalive -a telegram-bot-token   # to remove it
     ```
3. Set `telegramChatId` (a group's id is negative) and `telegramUserId` (only your presses count) with `/plugin configure cache-keepalive` or in `/config`. Telegram turns on once both the token and `telegramChatId` are set; `telegramUserId` is optional (without it, anyone in the chat can answer). To find both, reply to one of the bot's messages in the chat, then read the pending update without the token showing up in your shell history:
   ```bash
   read -rs TOK
   curl -s "https://api.telegram.org/bot$TOK/getUpdates?timeout=0" | jq '[.result[].message | {chat: .chat.id, user: .from.id, text}]'
   unset TOK
   ```

How answers arrive: Claude Code cannot receive pushes, so while a question is open the plugin polls `getUpdates` every 10 seconds. It never confirms an offset, because other sessions and machines may share the bot and confirming would delete their answers. Each reader takes only updates carrying its own session id. With privacy mode on, only button presses and replies are pending, and Telegram drops them after 24 hours.

## Seeing the state

Keepalive works without any status line. With none, you see it through `/keepalive status`, the expired band, and a toast if it turns itself off. For an always-visible state, pick the setup that matches yours.

The plugin writes its state to `~/.claude/keepalive/<session_id>.json`. `bin/keepalive-cache` turns that into a cache field:

```
🟢 58:54 keep 1/2
```

- The countdown runs from the later of the transcript's last assistant message and the last ping, with the TTL the plugin read. Counting from the transcript alone, as ccstatusline's built-in Cache Timer does, would fall to `❄️ COLD` after a ping while the cache is still warm: pings never reach the transcript.
- The tag after it: `keep 1/2` (pings used / cap), `⏸` (capped or stopped), `keep off` / `keep off·5m`.
- With no state file it prints what ccstatusline's built-in Cache Timer prints.

It reads the JSON Claude Code passes to every status line command (`session_id`, `transcript_path`), so it works with any of the setups below. It needs `node` on the `PATH` the status line runs with. `--ttl <seconds>` is the TTL assumed until the plugin has read the session's own (default 3600).

**All three need a refresh interval.** Claude Code redraws the status line only on events, and nothing happens while you are idle. Set `statusLine.refreshInterval` in `~/.claude/settings.json` (30 seconds is enough); ccstatusline's **Refresh interval** menu item writes the same setting.

### ccstatusline

In `~/.config/ccstatusline/settings.json`, replace the `cache-timer` item with a custom command item:

```json
{
  "id": "keepalive-cache",
  "type": "custom-command",
  "color": "yellow",
  "commandPath": "/absolute/path/to/plugins/cache-keepalive/bin/keepalive-cache --ttl 3600"
}
```

Keep ccstatusline's custom-command cache TTL at `0` (the default), or the field shows stale output.

### Your own status line script

Pass the same stdin to `keepalive-cache` and print its output where you want it:

```sh
#!/bin/sh
input=$(cat)
model=$(printf '%s' "$input" | jq -r '.model.display_name')
cache=$(printf '%s' "$input" | /absolute/path/to/plugins/cache-keepalive/bin/keepalive-cache)
printf '%s │ cache %s' "$model" "$cache"
```

### No status line

Either make `keepalive-cache` the whole status line:

```json
"statusLine": {
  "type": "command",
  "command": "/absolute/path/to/plugins/cache-keepalive/bin/keepalive-cache",
  "refreshInterval": 30
}
```

or turn on the `engineStatus` option. Claude Code then shows the state as a plugin status entry under the prompt, such as `keep 1/2 · ping 23:22`. It needs no setup, but the engine draws it on a row of its own with a warning-style prefix and the plugin's name. It shows clock times, not a countdown, because it only updates when the state changes. It is empty while you work.

## Limits

- No pings while the Mac sleeps: the process is asleep too. A timer that fires after the cache already expired skips the ping.
- A turn waiting on a permission prompt has not finished, so no ping is scheduled during it.
- After a prefix change (`/model`, a plugin reload that changes the system prompt or tools) the next ping misses once, and keepalive turns off for the session.

## Development

Design, decisions and their evidence: [docs/PRD.md](docs/PRD.md).

```bash
claude plugin validate plugins/cache-keepalive
claude --plugin-dir plugins/cache-keepalive   # once, so the engine lays .claude-plugin/types/ for tsc
tsc -p plugins/cache-keepalive
claude plugin test plugins/cache-keepalive    # hook tests (tests/*.test.ts)
node --test plugins/cache-keepalive/tests/widget.test.cjs   # status widget tests
```

Not yet in `marketplace.json`: run it with `--plugin-dir` for a week first.
