# Cost

Part of [cache-keepalive](../README.md).

A ping is not free: it re-reads the whole prefix at the cache-read rate. That rate depends on the model, and a rewrite after expiry is charged at the cache-write rate (2× input for the 1h TTL). Prices per million tokens, from [the pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (checked 2026-10-07):

| Model | Input | 1h cache write | Cache read |
|---|---|---|---|
| Claude Fable 5.1 | $10 | $20 | $0.25 (0.025×) |
| Claude Opus 5.5 | $4 | $8 | $0.20 (0.05×) |
| Claude Sonnet 5.5 | $2 | $4 | $0.20 (0.1×) |

With a 142k-token context and the 1h TTL:

| | Fable 5.1 | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|
| One ping | $0.036 | $0.028 | $0.028 |
| Default cap, 2 pings | $0.071 | $0.057 | $0.057 |
| One rewrite after expiry (1h write) | $2.84 | $1.14 | $0.57 |
| 2 pings as a share of one rewrite | 2.5% | 5% | 10% |

The ratio does not depend on the context size, so keeping warm pays off when there is more than a 2.5–10% chance you come back before the pings run out. The same prices make compact-before-expiry cheap: the summary request reads the warm cache instead of paying a rewrite.

**How long is it worth keeping warm?** Pings cost as much as one rewrite after about (1h write price ÷ cache-read price) pings, one every 55 minutes. This does not depend on context size, and the pricing page gives the same numbers for every model but two:

| Model | Break-even | About |
|---|---|---|
| Claude Fable 5.1, Mythos 5.1 (read 0.025× input) | 80 pings | 73 h |
| Claude Opus 5.5 (read 0.05×) | 40 pings | 37 h |
| Every other model: Fable 5, Mythos 5, Opus 5 and 4.x, Sonnet 5.5, 5 and 4.x, Haiku 4.5 and 3.5 (read 0.1×) | 20 pings | 18 h |

Past that, the pings cost more than the single rewrite they avoid. It only pays if you are sure to come back, so the default stays at 2 pings; `/keepalive brb` adds a note to its reply when you ask for more than the break-even for the model in use.

Sessions under 50k tokens of context are not kept warm, since a rewrite is cheap there. A **5-minute TTL** turns keepalive off. That rule assumes the 0.1× read rate: about 13 pings an hour is 1.3× input, more than one 1.25× rewrite. On Opus 5.5 (0.05×) and Fable 5.1 (0.025×) the same 13 pings would cost 0.65× and 0.33×, so the rule is conservative there. The Telegram question also estimates "one more hour warm" at 0.1×.

The TTL is read, not assumed: the turn's `usage` has no 1h/5m split, so the plugin reads `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` from the transcript tail.
