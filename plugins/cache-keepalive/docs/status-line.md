# Seeing the state

Part of [cache-keepalive](../README.md).

Keepalive works without any status line. With none, you see it through `/keepalive status`, the expired band, and a toast if it turns itself off. For an always-visible state, pick the setup that matches yours.

The plugin writes its state to `~/.claude/keepalive/<session_id>.json`. `bin/keepalive-cache` turns that into a cache field:

```
🟢58:54 kp 1/2
```

- The countdown runs from the later of the transcript's last assistant message and the last ping, with the TTL the plugin read. Counting from the transcript alone, as ccstatusline's built-in Cache Timer does, would fall to `❄️ COLD` after a ping while the cache is still warm: pings never reach the transcript.
- The tag after it: `kp 1/2` (keepalive: pings used / cap), `⏸` (capped or stopped), `kp off` / `kp off·5m`. Emoji and text are joined with no space to save width.
- An armed compact adds `✂03:12` (the clock time it is due), or `✂armed` while nothing is scheduled yet, for example during a `/goal` turn: `🔥HOT ✂armed`. It clears once the compact has run, when you send a plain prompt, or with `/keepalive compact off`.
- With no state file it prints what ccstatusline's built-in Cache Timer prints.

It reads the JSON Claude Code passes to every status line command (`session_id`, `transcript_path`), so it works with any of the setups below. It needs `node` on the `PATH` the status line runs with. `--ttl <seconds>` is the TTL assumed until the plugin has read the session's own (default 3600).

**All three need a refresh interval.** Claude Code redraws the status line only on events, and nothing happens while you are idle. Set `statusLine.refreshInterval` in `~/.claude/settings.json` (30 seconds is enough); ccstatusline's **Refresh interval** menu item writes the same setting.

## ccstatusline

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

## Your own status line script

Pass the same stdin to `keepalive-cache` and print its output where you want it:

```sh
#!/bin/sh
input=$(cat)
model=$(printf '%s' "$input" | jq -r '.model.display_name')
cache=$(printf '%s' "$input" | /absolute/path/to/plugins/cache-keepalive/bin/keepalive-cache)
printf '%s │ cache %s' "$model" "$cache"
```

## No status line

Either make `keepalive-cache` the whole status line:

```json
"statusLine": {
  "type": "command",
  "command": "/absolute/path/to/plugins/cache-keepalive/bin/keepalive-cache",
  "refreshInterval": 30
}
```

or turn on the `engineStatus` option. Claude Code then shows the state as a plugin status entry under the prompt, such as `keep 1/2 · ping 23:22`. It needs no setup, but the engine draws it on a row of its own with a warning-style prefix and the plugin's name. It shows clock times, not a countdown, because it only updates when the state changes. It is empty while you work.
