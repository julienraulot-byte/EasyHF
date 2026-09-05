import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import { VALIDATION_CASES, type ValidationCase } from './fixtures/validation-cases.js';

const GOLDEN_DIR = fileURLToPath(new URL('./golden', import.meta.url));
const UPDATE = env.UPDATE_GOLDEN === '1';

function run(testCase: ValidationCase) {
  return testCase.mode === 'check' ? checkPlan(testCase.input) : coordinate(testCase.input);
}

describe('reference cases (docs/VALIDATION.md)', () => {
  it('gives every case a distinct id, since the id names its golden file', () => {
    expect(new Set(VALIDATION_CASES.map((c) => c.id)).size).toBe(VALIDATION_CASES.length);
  });

  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.id} — ${testCase.title}`, () => {
      const actual = run(testCase);
      const goldenPath = join(GOLDEN_DIR, `${testCase.id}.json`);
      const serialised = `${JSON.stringify(actual, null, 2)}\n`;
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, serialised);
      }
      // Never write a missing golden on the fly: a witness that regenerates
      // itself is not a witness. Losing one must fail loudly.
      expect(
        existsSync(goldenPath),
        `Fichier témoin absent : ${testCase.id}.json. Relancer avec UPDATE_GOLDEN=1 pour le créer, puis relire la différence.`,
      ).toBe(true);
      expect(JSON.parse(serialised)).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
    });
  }

  it('reproduces every case byte for byte on a second run', () => {
    for (const testCase of VALIDATION_CASES) {
      expect(JSON.stringify(run(testCase))).toBe(JSON.stringify(run(testCase)));
    }
  });
});

describe('comparison with Wireless Workbench', () => {
  const withReference = VALIDATION_CASES.filter((c) => c.wwbReference);

  it.skipIf(withReference.length === 0)('detects every IM3 violation Wireless Workbench reports', () => {
    for (const testCase of withReference) {
      const result = run(testCase);
      const found = new Set(
        result.violations
          .filter((v) => v.kind === 'im3-2tx' || v.kind === 'im3-3tx')
          .map((v) => `${v.victimLinkId}<=${[...v.sourceLinkIds].sort().join('+')}`),
      );
      for (const expected of testCase.wwbReference?.im3 ?? []) {
        const key = `${expected.victimLinkId}<=${[...expected.sourceLinkIds].sort().join('+')}`;
        expect(found, `${testCase.id} : ${key} vu par WWB, manqué par EasyHF`).toContain(key);
      }
    }
  });

  it.skipIf(withReference.length > 0)(
    'is still waiting for the Wireless Workbench reference runs — Phase 0 gate is open',
    () => {
      expect(withReference).toHaveLength(0);
    },
  );
});
