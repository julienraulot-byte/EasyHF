import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = readdirSync(SRC).filter((name) => name.endsWith('.ts'));

/**
 * `@easyhf/shared` sits between the engine and everything else: it may import
 * the engine, never the hardware database or an app. The README states the
 * rule; this is where it holds.
 */
describe('dependency rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('imports only itself and the engine', () => {
    for (const name of files) {
      const source = readFileSync(join(SRC, name), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const specifier of specifiers) {
        expect(specifier, `${name} importe « ${specifier} »`).toMatch(/^\.\/|^@easyhf\/engine$/);
      }
    }
  });
});
