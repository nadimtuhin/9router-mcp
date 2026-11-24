import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('non-JSON 5xx bodies from chat, search and fetch report upstream_error with status', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    return new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] })).toEqual({ error: 'upstream_error', status: 502 });
    expect(await router.call('router_search', { provider: 'brave', query: 'q' })).toEqual({ error: 'upstream_error', status: 502 });
    expect(await router.call('router_fetch', { url: 'https://example.com' })).toEqual({ error: 'upstream_error', status: 502 });
    const log = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(l => JSON.parse(l));
    expect(log.map(r => r.status)).toEqual([502, 502, 502]);
    const pools = (await Bun.file(join(dir, 'limits.json')).json()).pools;
    expect(pools.glm.in_flight).toBe(0);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
