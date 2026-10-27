import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('fusion probe shares three-call counter with chat across router instances', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-')); let count = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    count++; return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  } });
  try {
    const options = { base: server.url.origin, cache: dir, db: join(dir, 'none'), headroom: async () => [{ pool: 'claude', status: 'SPEND' }] };
    for (let i = 0; i < 3; i++) expect((await createRouter(options).call('router_probe', { models: ['claude-fusion'] }))[0].status).toBe('ok');
    expect((await createRouter(options).call('router_probe', { models: ['claude-fusion'] }))[0].status).toBe('fusion_limit');
    expect(count).toBe(3);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
