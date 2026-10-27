import { test, expect } from 'bun:test';
import { createRouter } from './router';

test('claude and paid fetch refused before network or filesystem', async () => {
  let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { calls++; return Response.json({}); } });
  try {
    const router = createRouter({ base: server.url.origin, cache: import.meta.dir + '/unused', db: 'none', headroom: async () => [{ pool: 'claude', status: 'LOW' }] });
    for (const model of ['cc/claude', 'claude-fusion', 'sonnet-fushion', 'free-fushion']) {
      expect(await router.call('router_chat', { model, messages: [{ role: 'user', content: 'hi' }] })).toEqual({ error: 'claude_not_spend' });
    }
    expect(await router.call('router_fetch', { url: 'https://example.com', provider: 'firecrawl' })).toEqual({ error: 'firecrawl_requires_opt_in' });
    expect(calls).toBe(0);
  } finally { server.stop(true); }
});
