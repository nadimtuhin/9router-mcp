import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('a retry-after longer than the remaining deadline returns rate_limited, not router_down', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  let chats = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    chats++; return Response.json({}, { status: 429, headers: { 'retry-after': '15' } });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [], taskRows: [] });
    const start = Date.now();
    expect(await router.call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] })).toEqual({ error: 'rate_limited', alternative: null });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(chats).toBe(1);
    expect((await Bun.file(join(dir, 'limits.json')).json()).pools.glm.in_flight).toBe(0);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 15000);
