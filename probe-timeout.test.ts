import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('probe allows responses beyond chat timeout but within 30 seconds', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    await Bun.sleep(4100); return Response.json({ choices: [{ message: { content: 'OK' } }] });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_probe', { models: ['glm/test'] })).toEqual([{ model: 'glm/test', status: 'ok', latency_ms: expect.any(Number) }]);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 10000);
