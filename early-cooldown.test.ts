import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('cooldown is persisted from status and headers while the 429 body is still unread', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } }), { status: 429, headers: { 'retry-after': '300' } }) });
  try {
    const pending = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] }).call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] });
    await Bun.sleep(500);
    const wait = (await Bun.file(join(dir, 'limits.json')).json()).pools.glm.cooldown_until - Date.now();
    expect(wait).toBeGreaterThan(290000);
    server.stop(true); await pending;
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
