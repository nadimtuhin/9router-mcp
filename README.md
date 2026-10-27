# 9router-mcp

MCP server (stdio, newline-delimited JSON-RPC 2.0) for a local 9router LLM gateway. No dependencies; requires [Bun](https://bun.sh).

## Tools

- `router_models` - live models, pool headroom and seven-day call statistics
- `router_headroom` - pool capacity, cooldowns and in-flight calls
- `router_chat` - chat with exactly one model; never silently switches models, suggests an alternative from the task rows on rate limit
- `router_probe` - sequential eight-token probes
- `router_usage` - read-only usage totals by key name
- `router_search` / `router_fetch` - search and page fetch; paid Firecrawl needs `allow_firecrawl: true`

## Install

```
claude mcp add -s user 9router-mcp -- bun /absolute/path/to/9router-mcp/index.ts
```

Add `-e NAME=value` for any variable below.

## Configuration (environment)

- `ROUTER_BASE`: router origin; default `http://127.0.0.1:20128`. Loopback `127.0.0.1` only.
- `ROUTER_CACHE`: shared state directory (`limits.json`, `calls.jsonl`); default `~/.cache/pi-runs`.
- `ROUTER_DB`: router SQLite file; default `~/.9router/data.sqlite`. Read-only.
- `ROUTER_HEADROOM_SCRIPT`: executable run with `--json`; default `model-headroom`. Must print an array or `{pools: [...]}` of `{pool, percent_left, status, reset_at}`.
- `ROUTER_TASK_ROWS`: path to a JSON file of fallback rows; default `task-rows.json` next to `index.ts`.

Task rows are ordered lists of model IDs from weakest to strongest:

```json
[["glm/example-small"], ["cx/example-medium", "cx/example-large"]]
```

When a model in a row is rate limited, the next healthy model in the same row is suggested as `alternative`.

## Safety

- Key redaction: values from the router `apiKeys` table, `sk-` strings, `Bearer` tokens and secret-named fields are replaced with `[REDACTED]` in all output and logs. Only key names are ever selected for usage.
- Rate limits: per-pool concurrency caps, cooldowns from `retry-after` (or 5 minutes doubling to 60), a learned cap of N-1 after a 429, and a fusion-call cap.
- Prompts are never logged; the router DB is never written; no authorization header is sent.

## Tests

```
bun test <file>
```

Run files one at a time. `mutation.test.ts` temporarily edits `router.ts` and restores it; run it alone.

## Known gaps

- Search/fetch are not covered by the shared limits.
- Upstream body reads lack independent deadlines.
- A crashed process can leave a lock needing manual removal.
