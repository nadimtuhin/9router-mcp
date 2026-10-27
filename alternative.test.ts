import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('no guessed alternative when task row is unknown', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'glm/test' }, { id: 'cx/unrelated' }] });
    return Response.json({}, { status: 429, headers: { 'retry-after': '300' } });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [{ pool: 'cx', percent_left: 80 }] });
    expect(await router.call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] })).toMatchObject({ error: 'rate_limited', alternative: null });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
