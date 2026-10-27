import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('search and fetch forward explicit provider and paid opt-in; probe sequential 8-token requests', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const seen: any[] = []; let active = 0, peak = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(r) {
    const path = new URL(r.url).pathname;
    if (path === '/v1/models') return Response.json({ data: [] });
    const body: any = await r.json(); seen.push({ path, body });
    if (path !== '/v1/chat/completions') return Response.json({ results: [{ title: 'found', url: 'https://example.com', content: 'page' }] });
    active++; peak = Math.max(peak, active); await Bun.sleep(10); active--;
    return Response.json({ choices: [{ message: { content: 'OK' } }] }, { status: body.model === 'glm/bad' ? 503 : 200 });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_search', { provider: 'brave', query: 'school' })).toEqual({ results: [{ title: 'found', url: 'https://example.com', content: 'page' }] });
    expect(await router.call('router_fetch', { url: 'https://example.com', provider: 'firecrawl', allow_firecrawl: true })).toHaveProperty('results');
    const rows = await router.call('router_probe', { models: ['glm/ok', 'glm/bad'] });
    expect(rows).toEqual([{ model: 'glm/ok', status: 'ok', latency_ms: expect.any(Number) }, { model: 'glm/bad', status: 503, latency_ms: expect.any(Number) }]);
    expect(peak).toBe(1);
    expect(seen[0]).toEqual({ path: '/v1/search', body: { provider: 'brave', query: 'school' } });
    expect(seen[1]).toEqual({ path: '/v1/web/fetch', body: { provider: 'firecrawl', url: 'https://example.com' } });
    expect(seen.slice(2).map(r => [r.body.max_tokens, r.body.stream])).toEqual([[8, false], [8, false]]);
    expect((await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n')).toHaveLength(4);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
