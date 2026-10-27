import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

async function fixture(handler: (r: Request) => Response | Promise<Response>) {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  const router = createRouter({ base: server.url.origin, cache: dir, db: join(dir, 'missing.sqlite'), headroom: async () => [{ pool: 'glm', percent_left: 80, status: 'USE NOW' }] });
  return { router, dir, close: async () => { server.stop(true); await rm(dir, { recursive: true, force: true }); } };
}

test('models joins pool and headroom and filters live IDs', async () => {
  const f = await fixture(() => Response.json({ data: [{ id: 'glm/glm-5' }, { id: 'cx/gpt-5' }] }));
  try {
    const rows = await f.router.call('router_models', { filter: 'glm' });
    expect(rows).toEqual([expect.objectContaining({ id: 'glm/glm-5', pool: 'glm', percent_left: 80 })]);
  } finally { await f.close(); }
});
