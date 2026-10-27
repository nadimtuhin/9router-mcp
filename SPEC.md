# 9router MCP (thin, read-mostly layer over 127.0.0.1:20128)

Same shape as the pi MCP: no state of its own beyond the files listed here, no writes to 9router's DB, config, combos or keys. Localhost only.

## Tools
1. `router_models(filter?)` -> live ids from `/v1/models`, joined with pool, headroom % and reset time (`model-headroom --json`), and the 7-day success %, 429 count and p50 latency from the shared history.
2. `router_headroom()` -> per pool: % left, SPEND/USE NOW/LOW/EXHAUSTED, cooldown_until, in-flight count.
3. `router_chat(model, messages, max_tokens=1500, token_saver=true)` -> text with `<think>` stripped, plus finish_reason and usage.
   - Always sends `stream:false`. Raises max_tokens to 1200 minimum for reasoning models.
   - `token_saver=false` sends `x-9router-token-saver: off`.
   - Refuses `cc/` models and the claude-fusion/sonnet-fushion/free-fushion combos unless headroom shows claude SPEND.
   - Refuses fusion combos when called more than 3 times in 10 min (never in loops).
4. `router_probe(models[])` -> one 8-token call per model, one at a time, 30 s timeout: ok/429/503/400 and latency.
5. `router_usage(since="today")` -> who/provider/calls/Mtok from usageHistory via `sqlite3 -readonly`. Key names only, never key values.
6. `router_search(provider, query)` and `router_fetch(url, provider="jina-reader")` -> thin wrappers over `/v1/search` and `/v1/web/fetch`. firecrawl is refused unless the caller passes `allow_firecrawl=true`.

## Rate limits (shared with the pi MCP)
- Both MCPs use one file, `~/.cache/pi-runs/limits.json`, for caps, cooldowns and learned caps. Same rules as the pi MCP spec: default 6 concurrent calls per pool, cooldown from retry-after or 5 min doubling to 60 min, learned cap N-1.
- On 429/503, router_chat honors retry-after once if it is 20 s or less. Otherwise it returns `rate_limited` with the next model in the same task row whose pool is healthy. It never silently switches models.
- Each call appends one row to `~/.cache/pi-runs/calls.jsonl`: ts, model, pool, status, latency_ms, tokens. Prompts are never logged.

## Never
- Print or return a key. Return the Bearer header. Edit `data.sqlite`. Restart launchd. Call the remote router URL.

## Scenarios (Given/When/Then)
1. Given 9router is up, router_models returns at least one id, each with a pool.
2. Given a glm model, router_chat returns non-empty text with no `<think>` block.
3. Given a mocked 429 with retry-after 300, router_chat returns `rate_limited` plus an alternative from another pool, and the pool shows in cooldown in router_headroom.
4. Given claude is not SPEND, router_chat to `cc/...` is refused before any HTTP call.
5. Given 9router is down, every tool returns `router_down` within 10 s and never hangs.
6. Given the usage DB is missing, router_usage returns an empty list with a `db_missing` note.
7. Negative: no tool output, log row or error message ever contains a string from the apiKeys table. The test seeds a fake key and greps all outputs.

Every test must fail when its guard is deleted.
