import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('chat retries short retry-after once and fusion cap survives new instance', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-')); let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    calls++;
    if (calls === 1) return Response.json({}, { status: 429, headers: { 'retry-after': '0' } });
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 2 } });
  } });
  try {
    const options = { base: server.url.origin, cache: dir, db: 'none', headroom: async () => [{ pool: 'claude', status: 'SPEND' }] };
    const args = { model: 'claude-fusion', messages: [{ role: 'user', content: 'hi' }] };
    for (let i = 0; i < 3; i++) expect(await createRouter(options).call('router_chat', args)).toHaveProperty('text', 'ok');
    expect(await createRouter(options).call('router_chat', args)).toEqual({ error: 'fusion_limit' });
    expect(calls).toBe(4);
    expect((await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n')).toHaveLength(4);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
