import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('router_usage works without a sqlite3 binary on PATH and opens the DB read-only', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const dbPath = join(dir, 'data.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE apiKeys (id TEXT, name TEXT, key TEXT); CREATE TABLE usageHistory (apiKeyId TEXT, provider TEXT, timestamp TEXT, inputTokens INTEGER, outputTokens INTEGER)');
  db.query('INSERT INTO apiKeys VALUES (?, ?, ?)').run('one', 'worker', 'opaque-secret-value-123');
  db.query('INSERT INTO usageHistory VALUES (?, ?, ?, ?, ?)').run('one', 'glm', new Date().toISOString(), 2000000, 500000);
  db.query('INSERT INTO usageHistory VALUES (?, ?, ?, ?, ?)').run('one', 'glm', '2000-01-01T00:00:00.000Z', 9, 9);
  db.close();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ data: [] }) });
  const path = process.env.PATH;
  process.env.PATH = dir;
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: dbPath, headroom: async () => [] });
    expect(await router.call('router_usage')).toEqual({ rows: [{ who: 'worker', provider: 'glm', calls: 1, Mtok: 2.5 }] });
    expect(await router.call('router_usage', { since: '1999-01-01' })).toEqual({ rows: [{ who: 'worker', provider: 'glm', calls: 2, Mtok: 2.500018 }] });
    expect(await router.call('router_usage', { since: 'not a date' })).toEqual({ error: 'invalid_since' });
  } finally { process.env.PATH = path; server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
