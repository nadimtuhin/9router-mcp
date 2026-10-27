import { test, expect } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';

const cases = [
  ['model filter', "!args.filter || m.id.includes(args.filter)", 'true', 'router.test.ts'],
  ['think stripping', ".replace(/<think>[\\s\\S]*?<\\/think>/gi, '')", '', 'chat.test.ts'],
  ['cooldown check', 'p.cooldown_until > Date.now() || p.in_flight >= p.cap', 'p.in_flight >= p.cap', 'probe-limit.test.ts'],
  ['claude refusal', "return { error: 'claude_not_spend' }", 'void 0', 'refusal.test.ts'],
  ['missing DB', "return { rows: [], note: 'db_missing' }", "return { rows: [] }", 'usage.test.ts'],
  ['localhost boundary', "throw new Error('localhost_only')", 'void 0', 'boundary.test.ts'],
  ['fusion cap', 'state.fusion_calls.length >= 3', 'false', 'retry.test.ts'],
  ['release slot', 'p.in_flight--;', 'void 0;', 'recovery.test.ts'],
  ['upstream status', "if (!response.ok) return { error: 'upstream_error', status: response.status };", '', 'safety.test.ts'],
  ['opaque output and log redaction', "for (const key of keys) value = value.split(key).join('[REDACTED]');", '', 'opaque-key.test.ts'],
  ['sk redaction', ".replace(/\\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')", '', 'redaction.test.ts'],
  ['key redaction safety', "for (const key of keys) value = value.split(key).join('[REDACTED]');", '', 'safety.test.ts'],
  ['bearer redaction', ".replace(/Bearer\\s+[^\\s\"<>]+/gi, '[REDACTED]')", '', 'redaction.test.ts'],
  ['property name redaction', "[text(key), /api", "[key, /api", 'opaque-key.test.ts'],
  ['log redaction', 'JSON.stringify(clean(row))', 'JSON.stringify(row)', 'opaque-key.test.ts'],
  ['fusion probe counter', "if (/fusion|fushion/.test(model) && !(await fusion()))", 'if (false)', 'fusion-probe.test.ts'],
  ['overall deadline', 'controller.abort(), 9000', 'controller.abort(), 100000', 'deadline.test.ts'],
  ['http-date retry-after', 'Date.parse(header) - Date.now()', 'NaN', 'retry-date.test.ts'],
  ['cooldown before retry', 'if ([429, 503].includes(reply.status)) await cooldown(pool, reply);', '', 'retry-concurrency.test.ts'],
  ['alternative gated models', "if (id.startsWith('cc/') || /fusion|fushion/.test(id)) return false;", '', 'alternative-row.test.ts'],
  ['alternative cooldown', '!(local?.cooldown_until > Date.now()) &&', '', 'alternative-row.test.ts'],
  ['alternative health', "headroom.status !== 'EXHAUSTED' && headroom.percent_left !== 0", 'true', 'alternative-row.test.ts'],
  ['alternative cap', '(local?.in_flight ?? 0) < (local?.cap ?? 6)', 'true', 'alternative-row.test.ts'],
  ['alternative next not first', 'row.slice(row.indexOf(model) + 1)', 'row', 'alternative-row.test.ts'],
  ['early cooldown', 'if ([429, 503].includes(reply.status)) await cooldown(pool, reply);', '', 'early-cooldown.test.ts'],
  ['stdio concurrency', 'const task = handle(line);', 'const task = Promise.resolve(await handle(line));', 'stdio-concurrency.test.ts', 'index.ts']
];

test('guard removals cause focused tests to report failures, never timeouts', async () => {
  const originals = new Map<string, string>();
  try {
    for (const [name, guard, replacement, file, target = 'router.ts'] of cases) {
      const path = new URL(`./${target}`, import.meta.url);
      if (!originals.has(target)) originals.set(target, await readFile(path, 'utf8'));
      const original = originals.get(target)!;
      expect({ name, found: original.includes(guard) }).toEqual({ name, found: true });
      await writeFile(path, original.replaceAll(guard, replacement));
      const started = Date.now();
      const proc = Bun.spawn(['bun', 'test', file], { cwd: import.meta.dir, stdout: 'ignore', stderr: 'pipe', timeout: 20000 });
      const output = await new Response(proc.stderr).text();
      const code = await proc.exited;
      await writeFile(path, original);
      const timedOut = proc.signalCode !== null || Date.now() - started >= 19500;
      expect({ name, timedOut }).toEqual({ name, timedOut: false });
      expect({ name, killed: code !== 0 && /\b[1-9]\d* fail\b/.test(output) }).toEqual({ name, killed: true });
    }
  } finally { for (const [target, original] of originals) await writeFile(new URL(`./${target}`, import.meta.url), original); }
}, 400000);
