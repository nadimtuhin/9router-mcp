import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('a retried chat logs one row with attempts and counts once in models stats', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-')); let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'glm/test' }] });
    calls++;
    if (calls === 1) return Response.json({}, { status: 429, headers: { 'retry-after': '0' } });
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 2 } });
  } });
  try {
    const old = { ts: new Date().toISOString(), model: 'glm/test', pool: 'glm', status: 200, latency_ms: 5, tokens: 0 };
    await Bun.write(join(dir, 'calls.jsonl'), JSON.stringify(old) + '\n');
    const router = createRouter({ base: server.url.origin, cache: dir, db: 'none', headroom: async () => [] });
    expect(await router.call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] })).toHaveProperty('text', 'ok');
    expect(calls).toBe(2);
    const rows = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(l => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ model: 'glm/test', status: 200, attempts: 2, tokens: 2 });
    expect((await router.call('router_models'))[0]).toMatchObject({ success_percent: 100, count_429: 0 });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
