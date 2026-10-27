import { test, expect } from 'bun:test';
import { createRouter } from './router';

test('remote router URLs rejected before any I/O', () => {
  for (const base of ['https://example.com', 'http://localhost:20128', 'http://127.0.0.1.evil.test', 'http://user:pass@127.0.0.1:20128', 'http://127.0.0.1:20128/path']) {
    expect(() => createRouter({ base, cache: '.', db: 'none', headroom: async () => [] })).toThrow('localhost_only');
  }
});
