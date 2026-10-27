import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('probe never-answering HTTP returns router_down within ten seconds', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    return new Promise<Response>(() => {});
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    const start = Date.now();
    expect(await router.call('router_probe', { models: ['glm/test'] })).toEqual({ error: 'router_down' });
    expect(Date.now() - start).toBeLessThan(10000);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 12000);
