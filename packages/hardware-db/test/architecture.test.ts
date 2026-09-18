import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = readdirSync(SRC).filter((name) => name.endsWith('.ts'));

/**
 * `@easyhf/hardware-db` ships data, not behaviour. Its sources may borrow the
 * engine's *types* — a guard set is the engine's notion — but must not call
 * into it: the schema states the rules, and a second statement in TypeScript
 * would be the duplication that drifts (D-032, amended 18/09/2026).
 *
 * Tests are free to import anything, and they should: running real entries
 * through the real engine is what found the bugs behind D-020 and D-033.
 */
describe('dependency rule', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('borrows the engine and shared for types only, never at runtime', () => {
    for (const name of files) {
      const source = readFileSync(join(SRC, name), 'utf8');
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'(@easyhf\/[^']+)'/gm)];
      for (const [, isType, specifier] of imports) {
        expect(isType, `${name} importe « ${specifier} » à l'exécution`).toBeTruthy();
      }
    }
  });

  it('declares them as development dependencies, since nothing survives compilation', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(Object.keys(manifest.devDependencies ?? {})).toContain('@easyhf/engine');
  });
});
