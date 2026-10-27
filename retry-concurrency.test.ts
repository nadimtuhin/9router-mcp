import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('short retry records cooldown before sleeping and prevents concurrent same-pool request', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-')); let chats = 0; let signal!: () => void;
  const first = new Promise<void>(resolve => { signal = resolve; });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    chats++;
    if (chats === 1) { signal(); return Response.json({}, { status: 429, headers: { 'retry-after': '1' } }); }
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  } });
  try {
    const options = { base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] };
    const args = { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] };
    const pending = createRouter(options).call('router_chat', args);
    await first; await Bun.sleep(150);
    expect(await createRouter(options).call('router_chat', args)).toMatchObject({ error: 'rate_limited' });
    expect(await pending).toHaveProperty('text', 'ok');
    expect(chats).toBe(2);
    expect((await Bun.file(join(dir, 'limits.json')).json()).pools.glm.backoff_ms).toBeGreaterThan(0);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 5000);
