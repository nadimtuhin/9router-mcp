import { test, expect } from 'bun:test';

test('tools/call with an inherited property name returns an error instead of crashing the server', async () => {
  const proc = Bun.spawn(['bun', 'index.ts'], { cwd: import.meta.dir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'toString', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: '__proto__', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'ping' }
  ];
  proc.stdin.write(messages.map(m => JSON.stringify(m)).join('\n') + '\n'); proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  const rows = stdout.trim().split('\n').map(s => JSON.parse(s));
  expect(rows.find(r => r.id === 1)?.error?.code).toBe(-32602);
  expect(rows.find(r => r.id === 2)?.error?.code).toBe(-32602);
  expect(rows.find(r => r.id === 3)?.result).toEqual({});
});
