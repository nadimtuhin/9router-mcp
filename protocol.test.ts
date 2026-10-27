import { test, expect } from 'bun:test';

test('stdio initialize, discovery, invalid args, notifications, parse and method errors', async () => {
  const proc = Bun.spawn(['bun', 'index.ts'], { cwd: import.meta.dir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'router_chat', arguments: { model: 'glm/test', messages: 'bad' } } },
    { jsonrpc: '2.0', id: 4, method: 'unknown' },
    { jsonrpc: '2.0', id: 5, method: 'ping' }
  ];
  proc.stdin.write(messages.map(m => JSON.stringify(m)).join('\n') + '\nnot-json\n'); proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0); expect(stderr).toBe('');
  const rows = stdout.trim().split('\n').map(s => JSON.parse(s));
  expect(rows).toHaveLength(6);
  expect(rows.find(r => r.id === 1).result).toMatchObject({ protocolVersion: '2024-11-05', capabilities: { tools: {} } });
  expect(rows.find(r => r.id === 2).result.tools.map((t: any) => t.name)).toEqual(['router_models', 'router_headroom', 'router_chat', 'router_probe', 'router_usage', 'router_search', 'router_fetch']);
  expect(rows.find(r => r.id === 3).error.code).toBe(-32602);
  expect(rows.find(r => r.id === 4).error.code).toBe(-32601);
  expect(rows.find(r => r.id === 5).result).toEqual({});
  expect(rows.find(r => r.id === null).error.code).toBe(-32700);
});
