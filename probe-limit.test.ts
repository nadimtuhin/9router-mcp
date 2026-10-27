import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('probe respects persisted pool cooldown without chat HTTP call', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-')); let chats = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname !== '/v1/models') chats++;
    return Response.json({ data: [] });
  } });
  try {
    await Bun.write(join(dir, 'limits.json'), JSON.stringify({ pools: { glm: { cap: 6, in_flight: 0, cooldown_until: Date.now() + 60000 } } }));
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_probe', { models: ['glm/test'] })).toEqual([{ model: 'glm/test', status: 'rate_limited', latency_ms: 0 }]);
    expect(chats).toBe(0);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
