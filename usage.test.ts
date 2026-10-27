import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('missing usage DB returns empty rows with note', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ data: [] }) });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: join(dir, 'none'), headroom: async () => [] });
    expect(await router.call('router_usage')).toEqual({ rows: [], note: 'db_missing' });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
