import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('long retry-after persists cooldown, learns cap, suggests another pool, blocks repeat', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'glm/glm-5' }, { id: 'cx/gpt-5' }] });
    calls++; return new Response('{}', { status: 429, headers: { 'retry-after': '300' } });
  } });
  try {
    const options = { taskRows: [['glm/glm-5', 'cx/gpt-5']], base: server.url.origin, cache: dir, db: join(dir, 'none'), headroom: async () => [{ pool: 'glm', percent_left: 80 }, { pool: 'cx', percent_left: 90 }] };
    const router = createRouter(options);
    const args = { model: 'glm/glm-5', messages: [{ role: 'user', content: 'hi' }] };
    expect(await router.call('router_chat', args)).toMatchObject({ error: 'rate_limited', alternative: 'cx/gpt-5' });
    const pools = await router.call('router_headroom');
    expect(pools.find((p: any) => p.pool === 'glm').cooldown_until).toBeGreaterThan(Date.now());
    const state = await Bun.file(join(dir, 'limits.json')).json();
    expect(state.pools.glm.cap).toBe(1);
    expect(state.pools.glm.in_flight).toBe(0);
    expect(await createRouter(options).call('router_chat', args)).toMatchObject({ error: 'rate_limited' });
    expect(calls).toBe(1);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
