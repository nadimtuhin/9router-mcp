import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRouter } from './router';

const string = { type: 'string', minLength: 1 };
const definitions: Record<string, { description: string; properties: Record<string, any>; required: string[] }> = {
  router_models: { description: 'Live models, pool headroom and seven-day call statistics.', properties: { filter: string }, required: [] },
  router_headroom: { description: 'Pool capacity, cooldowns and in-flight calls.', properties: {}, required: [] },
  router_chat: { description: 'Chat using exactly one model; never silently switches models.', properties: { model: string, messages: { type: 'array', minItems: 1, items: { type: 'object', properties: { role: { enum: ['system', 'user', 'assistant'] }, content: string }, required: ['role', 'content'], additionalProperties: false } }, max_tokens: { type: 'integer', minimum: 1, default: 1500 }, token_saver: { type: 'boolean', default: true } }, required: ['model', 'messages'] },
  router_probe: { description: 'Sequential eight-token probes.', properties: { models: { type: 'array', minItems: 1, maxItems: 100, items: string } }, required: ['models'] },
  router_usage: { description: 'Read-only usage totals; key names only.', properties: { since: { ...string, default: 'today' } }, required: [] },
  router_search: { description: 'Search; paid Firecrawl requires explicit opt-in.', properties: { provider: string, query: string, allow_firecrawl: { type: 'boolean' } }, required: ['provider', 'query'] },
  router_fetch: { description: 'Fetch public URL; paid Firecrawl requires explicit opt-in.', properties: { url: string, provider: { ...string, default: 'jina-reader' }, allow_firecrawl: { type: 'boolean' } }, required: ['url'] }
};
function valid(value: any, schema: any): boolean {
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum;
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= (schema.maxItems ?? 10000) && value.every(v => valid(v, schema.items));
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) && schema.required.every((k: string) => k in value) && Object.keys(value).every(k => schema.properties[k] && valid(value[k], schema.properties[k]));
  return false;
}
const taskRowsPath = process.env.ROUTER_TASK_ROWS ?? new URL('task-rows.json', import.meta.url).pathname;
const taskRows: string[][] = (() => { try { return JSON.parse(readFileSync(taskRowsPath, 'utf8')); } catch { return []; } })();
const headroomScript = process.env.ROUTER_HEADROOM_SCRIPT ?? 'model-headroom';
const router = createRouter({
  taskRows,
  base: process.env.ROUTER_BASE ?? 'http://127.0.0.1:20128', cache: process.env.ROUTER_CACHE ?? join(homedir(), '.cache/pi-runs'),
  db: process.env.ROUTER_DB ?? join(homedir(), '.9router/data.sqlite'),
  async headroom() {
    const proc = Bun.spawn([headroomScript, '--json'], { stdout: 'pipe', stderr: 'ignore', timeout: 3000 });
    const text = await new Response(proc.stdout).text();
    if (await proc.exited !== 0) throw new Error('headroom_unavailable');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.pools;
  }
});
async function handle(line: string) {
  let request: any;
  const send = (payload: any) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, ...payload }) + '\n');
  try { request = JSON.parse(line); } catch { send({ error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) { send({ error: { code: -32600, message: 'Invalid request' } }); return; }
  if (request.id === undefined) return;
  if (request.method === 'initialize') { send({ result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: '9router-mcp', version: '0.1.0' } } }); return; }
  if (request.method === 'ping') { send({ result: {} }); return; }
  if (request.method === 'tools/list') { send({ result: { tools: Object.entries(definitions).map(([name, d]) => ({ name, description: d.description, inputSchema: { type: 'object', properties: d.properties, required: d.required, additionalProperties: false } })) } }); return; }
  if (request.method !== 'tools/call') { send({ error: { code: -32601, message: 'Method not found' } }); return; }
  const d = definitions[request.params?.name];
  const args = request.params?.arguments ?? {};
  if (!d || !valid(args, { type: 'object', ...d })) { send({ error: { code: -32602, message: 'Invalid tool arguments' } }); return; }
  const result = await router.call(request.params.name, args);
  send({ result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !!result?.error } });
}
const pending = new Set<Promise<void>>();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim()) {
    const task = handle(line);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
}
await Promise.allSettled(pending);
