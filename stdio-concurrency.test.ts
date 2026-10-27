import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

test('a slow tool call does not block later requests on stdio', async () => {
  const dir = await mkdtemp(join(import.meta.dir, '.test-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Promise<Response>(() => {}) });
  const proc = Bun.spawn(['bun', 'index.ts'], { cwd: import.meta.dir, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...process.env, ROUTER_BASE: server.url.origin, ROUTER_CACHE: dir, ROUTER_DB: join(dir, 'none') } });
  try {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'router_chat', arguments: { model: 'glm/test', messages: [{ role: 'user', content: 'hi' }] } } }) + '\n');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
    proc.stdin.flush();
    const reader = proc.stdout.getReader();
    const first = await Promise.race([reader.read(), Bun.sleep(2500).then(() => null)]);
    expect(first).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(first!.value)).id).toBe(2);
  } finally { proc.kill(); server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 8000);
