import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('models computes seven-day success, 429 count and p50 from shared history', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ data: [{ id: 'glm/test' }] }) });
  try {
    await Bun.write(join(dir, 'calls.jsonl'), [
      { ts: new Date().toISOString(), model: 'glm/test', status: 200, latency_ms: 10 },
      { ts: new Date().toISOString(), model: 'glm/test', status: 429, latency_ms: 30 },
      { ts: '2000-01-01', model: 'glm/test', status: 200, latency_ms: 900 }
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect((await router.call('router_models'))[0]).toMatchObject({ success_percent: 50, count_429: 1, p50_latency_ms: 10 });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
