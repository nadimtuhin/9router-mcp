import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouter } from './router';

test('opaque database key is redacted in output values, property names, and logs', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const secret = 'opaque-fixture-value-92844';
  const db = new Database(join(dir, 'fake.sqlite'));
  db.exec('CREATE TABLE apiKeys (key TEXT)');
  db.query('INSERT INTO apiKeys VALUES (?)').run(secret); db.close();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(r) {
    if (new URL(r.url).pathname === '/v1/models') return Response.json({ data: [] });
    return Response.json({ [secret]: `value ${secret}`, usage: { total_tokens: secret }, choices: [{ message: { content: secret }, finish_reason: 'stop' }] });
  } });
  try {
    const router = createRouter({ base: server.url.origin, cache: dir, db: join(dir, 'fake.sqlite'), headroom: async () => [] });
    const output = await router.call('router_search', { provider: `provider-${secret}`, query: 'fixture' });
    const chat = await router.call('router_chat', { model: `glm/${secret}`, messages: [{ role: 'user', content: 'fixture' }] });
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(JSON.stringify(chat)).not.toContain(secret);
    expect(await Bun.file(join(dir, 'calls.jsonl')).text()).not.toContain(secret);
    expect(JSON.stringify(output)).toContain('[REDACTED]');
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
