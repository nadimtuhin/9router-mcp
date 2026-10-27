import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('malformed chat releases slot and logs failure', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('invalid-json') });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_chat', { model: 'glm/test', messages: [] })).toEqual({ error: 'tool_failed' });
    expect((await Bun.file(join(dir, 'limits.json')).json()).pools.glm.in_flight).toBe(0);
    expect(JSON.parse(await Bun.file(join(dir, 'calls.jsonl')).text()).status).toBe(200);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
