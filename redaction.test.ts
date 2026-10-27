import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('successful text and nested responses redact keys and Bearer headers', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const secret = 'sk-fake-secret-123456789';
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'glm/test' }] });
    return Response.json({ choices: [{ message: { content: `answer ${secret} Bearer opaque-value` }, finish_reason: 'stop' }], usage: { total_tokens: 2, apiKey: secret }, results: [{ api_key: secret, content: `page ${secret}` }], authorization: 'Bearer opaque-value' });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    for (const name of ['router_chat', 'router_search', 'router_fetch']) {
      const result = await router.call(name, { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }], provider: 'jina-reader', query: 'hi', url: 'https://example.com' });
      const output = JSON.stringify(result);
      expect(output).not.toContain(secret);
      expect(output).not.toContain('opaque-value');
      expect(output).toContain('[REDACTED]');
    }
    expect(await Bun.file(join(dir, 'calls.jsonl')).text()).not.toContain(secret);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
