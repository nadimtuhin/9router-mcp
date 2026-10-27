import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { mkdir, appendFile, readFile, writeFile, rename, rmdir } from 'node:fs/promises';

type Pool = { pool: string; percent_left?: number; status?: string; reset_at?: string };
type Options = { base: string; cache: string; db: string; headroom: () => Promise<Pool[]>; taskRows?: string[][] };
export function createRouter(options: Options) {
  const base = new URL(options.base);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('localhost_only');
  async function redactor() {
    let keys: string[] = [];
    if (await Bun.file(options.db).exists()) {
      let db: Database | undefined;
      try {
        db = new Database(options.db, { readonly: true });
        keys = (db.query('SELECT key FROM apiKeys').all() as { key: unknown }[]).map(row => row.key).filter((key): key is string => typeof key === 'string' && key.length > 0).sort((a, b) => b.length - a.length);
      } catch { throw new Error('redaction_unavailable'); } finally { db?.close(); }
    }
    const text = (value: string) => {
      for (const key of keys) value = value.split(key).join('[REDACTED]');
      return value.replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/Bearer\s+[^\s"<>]+/gi, '[REDACTED]');
    };
    const clean = (value: any): any => {
      if (typeof value === 'string') return text(value);
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), /api.?key|authorization|bearer|secret/i.test(key) ? '[REDACTED]' : clean(item)]));
      return value;
    };
    return clean;
  }
  async function log(row: any) {
    const clean = await redactor();
    await mkdir(options.cache, { recursive: true });
    await appendFile(join(options.cache, 'calls.jsonl'), JSON.stringify(clean(row)) + '\n');
  }
  function retryMs(response: Response) {
    const header = response.headers.get('retry-after');
    if (header === null) return null;
    const ms = /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    return Number.isFinite(ms) ? Math.max(0, ms) : null;
  }
  async function cooldown(pool: string, response: Response) {
    await limits(state => {
      const p = state.pools[pool];
      p.backoff_ms = Math.min((p.backoff_ms || 150000) * 2, 3600000);
      p.cooldown_until = Date.now() + (retryMs(response) ?? p.backoff_ms);
      p.cap = Math.max(1, p.in_flight - 1);
    });
  }
  async function fusion() {
    return limits(state => {
      state.fusion_calls = (state.fusion_calls ?? []).filter((t: number) => t > Date.now() - 600000);
      if (state.fusion_calls.length >= 3) return false;
      state.fusion_calls.push(Date.now()); return true;
    });
  }
  async function limits(update?: (state: any) => any) {
    await mkdir(options.cache, { recursive: true });
    const lock = join(options.cache, 'limits.lock');
    const deadline = Date.now() + 2000;
    while (true) {
      try { await mkdir(lock); break; } catch (error: any) {
        if (error.code !== 'EEXIST' || Date.now() > deadline) throw new Error('limits_unavailable');
        await Bun.sleep(10);
      }
    }
    try {
      let state: any;
      try { state = JSON.parse(await readFile(join(options.cache, 'limits.json'), 'utf8')); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; state = { pools: {} }; }
      state.pools ??= {};
      const result = update ? update(state) : state;
      if (update) {
        const temporary = join(options.cache, 'limits.tmp');
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, join(options.cache, 'limits.json'));
      }
      return result;
    } finally { await rmdir(lock); }
  }
  async function request(path: string, init: RequestInit = {}, timeout = 4000, signal?: AbortSignal) {
    try { return await fetch(options.base + path, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
    catch { throw new Error('router_down'); }
  }
  async function alternative(model: string) {
    const row = (options.taskRows ?? []).find(r => r.includes(model));
    if (!row) return null;
    const pools = await options.headroom();
    const state = await limits();
    const poolOf = (id: string) => id.split('/')[0];
    const healthy = row.slice(row.indexOf(model) + 1).find(id => {
      if (id.startsWith('cc/') || /fusion|fushion/.test(id)) return false;
      const headroom = pools.find(p => p.pool === poolOf(id));
      const local = state.pools[poolOf(id)];
      return headroom && headroom.status !== 'EXHAUSTED' && headroom.percent_left !== 0 && !(local?.cooldown_until > Date.now()) && (local?.in_flight ?? 0) < (local?.cap ?? 6);
    });
    return healthy ?? null;
  }
  async function call(name: string, args: Record<string, any> = {}, signal: AbortSignal): Promise<any> {
    const requestWithDeadline = (path: string, init: RequestInit = {}, timeout = 4000) => request(path, init, timeout, signal);
    if (['router_fetch', 'router_search'].includes(name) && /firecrawl/i.test(args.provider ?? '') && args.allow_firecrawl !== true) return { error: 'firecrawl_requires_opt_in' };
    if (name === 'router_chat' && (args.model.startsWith('cc/') || ['claude-fusion', 'sonnet-fushion', 'free-fushion'].includes(args.model)) && !(await options.headroom()).some(p => p.pool === 'claude' && p.status === 'SPEND')) return { error: 'claude_not_spend' };
    if (name !== 'router_chat' && name !== 'router_models') await requestWithDeadline('/v1/models');
    if (name === 'router_probe') {
      const rows = [];
      for (const model of args.models) {
        if ((model.startsWith('cc/') || /fusion|fushion/.test(model)) && !(await options.headroom()).some(p => p.pool === 'claude' && p.status === 'SPEND')) { rows.push({ model, status: 'claude_not_spend', latency_ms: 0 }); continue; }
        if (/fusion|fushion/.test(model) && !(await fusion())) { rows.push({ model, status: 'fusion_limit', latency_ms: 0 }); continue; }
        const pool = model.startsWith('cc/') || /fusion|fushion/.test(model) ? 'claude' : model.split('/')[0];
        const acquired = await limits(state => {
          const p = state.pools[pool] ??= { cap: 6, in_flight: 0 };
          if (p.cooldown_until > Date.now() || p.in_flight >= p.cap) return false;
          p.in_flight++; return true;
        });
        if (!acquired) { rows.push({ model, status: 'rate_limited', latency_ms: 0 }); continue; }
        const start = Date.now();
        let response: Response | undefined;
        try {
        response = await requestWithDeadline('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 8, stream: false }) }, 30000);
        if ([429, 503].includes(response.status)) await cooldown(pool, response);
        await response.arrayBuffer();
        } finally {
          await limits(state => {
            const p = state.pools[pool];
            p.in_flight--;
          });
          await log({ ts: new Date().toISOString(), model, pool, status: response?.status ?? 'router_down', latency_ms: Date.now() - start, tokens: 0 });
        }
        rows.push({ model, status: response.ok ? 'ok' : response.status, latency_ms: Date.now() - start });
      }
      return rows;
    }
    if (name === 'router_search' || name === 'router_fetch') {
      const start = Date.now();
      const provider = args.provider ?? 'jina-reader';
      const response = await requestWithDeadline(name === 'router_search' ? '/v1/search' : '/v1/web/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(name === 'router_search' ? { provider, query: args.query } : { provider, url: args.url }) });
      const body = await response.json();
      await mkdir(options.cache, { recursive: true });
      await log({ ts: new Date().toISOString(), model: provider, pool: provider, status: response.status, latency_ms: Date.now() - start, tokens: 0 });
      return response.ok ? body : { error: 'upstream_error', status: response.status };
    }
    if (name === 'router_usage') {
      if (!await Bun.file(options.db).exists()) return { rows: [], note: 'db_missing' };
      const since = args.since ?? 'today';
      const date = since === 'today' ? new Date().toISOString().slice(0, 10) : new Date(since).toISOString();
      const sql = `SELECT k.name AS who, u.provider, count(*) AS calls, sum(u.inputTokens + u.outputTokens) / 1000000.0 AS Mtok FROM usageHistory u LEFT JOIN apiKeys k ON k.id = u.apiKeyId WHERE u.timestamp >= '${date}' GROUP BY k.name, u.provider`;
      const proc = Bun.spawn(['sqlite3', '-readonly', '-json', options.db, sql], { stdout: 'pipe', stderr: 'ignore', timeout: 3000 });
      const output = await new Response(proc.stdout).text();
      if (await proc.exited !== 0) return { error: 'usage_unavailable' };
      return { rows: JSON.parse(output || '[]') };
    }
    if (name === 'router_headroom') {
      const state = await limits();
      return (await options.headroom()).map(p => ({ ...p, ...state.pools[p.pool], in_flight: state.pools[p.pool]?.in_flight ?? 0 }));
    }
    if (name === 'router_chat') {
      const pool = /fusion|fushion/.test(args.model) || args.model.startsWith('cc/') ? 'claude' : args.model.split('/')[0];
      if (/fusion|fushion/.test(args.model)) {
        const allowed = await fusion();
        if (!allowed) return { error: 'fusion_limit' };
      }
      const acquired = await limits(state => {
        const p = state.pools[pool] ??= { cap: 6, in_flight: 0 };
        if (p.cooldown_until > Date.now() || p.in_flight >= p.cap) return false;
        p.in_flight++; return true;
      });
      if (!acquired) return { error: 'rate_limited', alternative: await alternative(args.model) };
      const start = Date.now();
      let response: Response | undefined;
      let body: any;
      try {
      const send = async () => {
        const reply = await requestWithDeadline('/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', ...(args.token_saver === false ? { 'x-9router-token-saver': 'off' } : {}) },
          body: JSON.stringify({ model: args.model, messages: args.messages, stream: false, max_tokens: Math.max(args.max_tokens ?? 1500, /glm|reason|deepseek|[/]o[134]/i.test(args.model) ? 1200 : 1) })
        });
        if ([429, 503].includes(reply.status)) await cooldown(pool, reply);
        return reply;
      };
      response = await send();
      if ([429, 503].includes(response.status)) {
        const wait = retryMs(response);
        if (wait !== null && wait <= 20000) {
          await log({ ts: new Date().toISOString(), model: args.model, pool, status: response.status, latency_ms: Date.now() - start, tokens: 0 });
          await Bun.sleep(wait);
          response = await send();
        }
      }
      body = await response.json();
      } finally {
      await limits(state => {
        const p = state.pools[pool];
        p.in_flight--;
      });
      await mkdir(options.cache, { recursive: true });
      await log({ ts: new Date().toISOString(), model: args.model, pool: args.model.split('/')[0], status: response?.status ?? 'router_down', latency_ms: Date.now() - start, tokens: body?.usage?.total_tokens ?? 0 });
      }
      if (response.status === 429 || response.status === 503) return { error: 'rate_limited', alternative: await alternative(args.model) };
      if (!response.ok) return { error: 'upstream_error', status: response.status };
      return { text: body.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), finish_reason: body.choices[0].finish_reason, usage: body.usage };
    }
    if (name === 'router_models') {
      const response = await requestWithDeadline('/v1/models');
      const body = await response.json() as any;
      const pools = await options.headroom();
      let history: any[] = [];
      try {
        history = (await readFile(join(options.cache, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).filter(r => Date.parse(r.ts) >= Date.now() - 7 * 86400000);
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      return body.data.filter((m: any) => !args.filter || m.id.includes(args.filter)).map((m: any) => {
        const pool = m.id.split('/')[0];
        const rows = history.filter(r => r.model === m.id);
        const latencies = rows.map(r => r.latency_ms).sort((a, b) => a - b);
        return { id: m.id, pool, ...pools.find(p => p.pool === pool), success_percent: rows.length ? rows.filter(r => r.status >= 200 && r.status < 300).length / rows.length * 100 : null, count_429: rows.filter(r => r.status === 429).length, p50_latency_ms: latencies.length ? latencies[Math.ceil(latencies.length / 2) - 1] : null };
      });
    }
    return { error: 'unknown_tool' };
  }
  return { async call(name: string, args: Record<string, any> = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('router_down')), { once: true }));
      const work = (async () => { const clean = await redactor(); return clean(await call(name, args, controller.signal)); })();
      work.catch(() => {});
      return await Promise.race([work, aborted]);
    }
    catch (error: any) { return { error: error.message === 'router_down' ? 'router_down' : 'tool_failed' }; }
    finally { clearTimeout(timer); }
  } };
}
