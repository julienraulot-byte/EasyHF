import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = readdirSync(SRC).filter((name) => name.endsWith('.ts'));

/** Source with comments removed, so prose about a "guard window" is not a finding. */
function code(name: string): string {
  return readFileSync(join(SRC, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * `@easyhf/engine` has to run unchanged in a service worker, in a Node script
 * and in a test runner. The rule that makes that hold is enforced here rather
 * than in a comment nobody reads.
 */
describe('dependency rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports nothing but its own modules', () => {
    for (const name of files) {
      const source = code(name);
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const specifier of specifiers) {
        expect(specifier, `${name} importe « ${specifier} »`).toMatch(/^\.\//);
      }
    }
  });

  it('touches neither the DOM nor the Node runtime', () => {
    for (const name of files) {
      const source = code(name);
      for (const forbidden of ['document.', 'window.', 'process.', 'require(', 'globalThis.']) {
        expect(source, `${name} référence « ${forbidden} »`).not.toContain(forbidden);
      }
    }
  });

  it('keeps results reproducible: no clock, no randomness, no locale', () => {
    for (const name of files) {
      const source = code(name);
      // `localeCompare` and `Intl` order strings by the host locale, which would
      // make a plan depend on the machine that built it just as surely as a
      // random number would.
      for (const forbidden of [
        'Math.random',
        'Date.now',
        'new Date',
        'performance.now',
        'localeCompare',
        'Intl.',
      ]) {
        expect(source, `${name} référence « ${forbidden} »`).not.toContain(forbidden);
      }
    }
  });
});
