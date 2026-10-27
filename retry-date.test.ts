import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('probe records HTTP-date retry-after rather than fallback', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    return Response.json({}, { status: 429, headers: { 'retry-after': new Date(Date.now() + 60000).toUTCString() } });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    await router.call('router_probe', { models: ['glm/test'] });
    const wait = (await Bun.file(join(dir, 'limits.json')).json()).pools.glm.cooldown_until - Date.now();
    expect(wait).toBeGreaterThan(57000); expect(wait).toBeLessThan(61000);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
