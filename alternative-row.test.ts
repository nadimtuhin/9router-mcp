import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

const rows = [['pre/a', 'glm/a', 'cc/opus', 'claude-fusion', 'ag/x', 'ollama/b', 'full/d', 'oc/c', 'oc/e']];
const headroom = async () => ['pre', 'glm', 'cc', 'claude-fusion', 'ollama', 'full', 'oc'].map(pool => ({ pool, percent_left: 90 })).concat([{ pool: 'ag', percent_left: 0 }]);

async function run(extra: object = {}) {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({}, { status: 429, headers: { 'retry-after': '300' } }) });
  try {
    await Bun.write(join(dir, 'limits.json'), JSON.stringify({ pools: { ollama: { cap: 6, in_flight: 0, cooldown_until: Date.now() + 60000 }, full: { cap: 2, in_flight: 2 }, ...extra } }));
    return await createRouter({ taskRows: rows, base: server.url.origin, cache: dir, db: 'none', headroom }).call('router_chat', { model: 'glm/a', messages: [{ role: 'user', content: 'hi' }] });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}

test('alternative is the next eligible model after the current one, skipping gated, exhausted, cooling and capped', async () => {
  expect(await run()).toMatchObject({ error: 'rate_limited', alternative: 'oc/c' });
});

test('unknown model has no alternative', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({}, { status: 429, headers: { 'retry-after': '300' } }) });
  try {
    expect(await createRouter({ taskRows: rows, base: server.url.origin, cache: dir, db: 'none', headroom }).call('router_chat', { model: 'zzz/q', messages: [{ role: 'user', content: 'hi' }] })).toMatchObject({ alternative: null });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
