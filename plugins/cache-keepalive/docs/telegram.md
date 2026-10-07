# Telegram (optional)

Part of [cache-keepalive](../README.md).

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
