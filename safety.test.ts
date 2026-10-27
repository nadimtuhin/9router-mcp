import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('usage reads aggregates only; upstream errors and metadata cannot leak seeded key', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const secret = 'fake-opaque-DO-NOT-RETURN-123456789';
  const dbPath = join(dir, 'data.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE apiKeys (id TEXT, name TEXT, key TEXT); CREATE TABLE usageHistory (apiKeyId TEXT, provider TEXT, timestamp TEXT, inputTokens INTEGER, outputTokens INTEGER)');
  db.query('INSERT INTO apiKeys VALUES (?, ?, ?)').run('one', 'fake-worker', secret);
  db.query('INSERT INTO usageHistory VALUES (?, ?, ?, ?, ?)').run('one', 'glm', new Date().toISOString(), 1000000, 500000);
  db.close();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'glm/test-' + secret }] });
    return Response.json({ error: { message: secret } }, { status: 400 });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: dbPath, headroom: async () => [] });
    const outputs = [];
    outputs.push(await router.call('router_models'));
    const usage = await router.call('router_usage'); outputs.push(usage);
    expect(usage).toEqual({ rows: [{ who: 'fake-worker', provider: 'glm', calls: 1, Mtok: 1.5 }] });
    outputs.push(await router.call('router_chat', { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] }));
    expect(outputs[2]).toEqual({ error: 'upstream_error', status: 400 });
    expect(JSON.stringify(outputs)).not.toContain(secret);
    expect(await Bun.file(join(dir, 'calls.jsonl')).text()).not.toContain(secret);
    expect(new Database(dbPath, { readonly: true }).query('SELECT count(*) AS n FROM apiKeys').get()).toEqual({ n: 1 });
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
