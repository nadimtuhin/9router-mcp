import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('glm chat strips reasoning and enforces wire options', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  let body: any, saver: string | null = null;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(r) {
    body = await r.json(); saver = r.headers.get('x-9router-token-saver');
    return Response.json({ choices: [{ message: { content: '<think>secret reasoning</think>answer' }, finish_reason: 'stop' }], usage: { total_tokens: 12 } });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: join(dir, 'none'), headroom: async () => [] });
    expect(await router.call('router_chat', { model: 'glm/glm-5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 8, token_saver: false })).toEqual({ text: 'answer', finish_reason: 'stop', usage: { total_tokens: 12 } });
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1200);
    expect(saver).toBe('off');
    const log = await Bun.file(join(dir, 'calls.jsonl')).text();
    expect(JSON.parse(log).tokens).toBe(12);
    expect(log).not.toContain('hello');
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
