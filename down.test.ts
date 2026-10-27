import { test, expect } from 'bun:test';
import { createRouter } from './router';

test('every tool reports router_down promptly without leaking transport errors', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const base = server.url.origin; server.stop(true);
  const router = createRouter({ base, cache: import.meta.dir + '/unused', db: 'none', headroom: async () => [] });
  const start = Date.now();
  for (const name of ['router_models', 'router_headroom', 'router_chat', 'router_probe', 'router_usage', 'router_search', 'router_fetch']) {
    expect(await router.call(name, { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }], models: ['glm/test'], provider: 'jina-reader', query: 'hi', url: 'https://example.com' })).toEqual({ error: 'router_down' });
  }
  expect(Date.now() - start).toBeLessThan(10000);
});
