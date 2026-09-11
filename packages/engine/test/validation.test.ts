import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import { VALIDATION_CASES, type ValidationCase, type WwbReference } from './fixtures/validation-cases.js';

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

  it.skipIf(withReference.length === 0)('flags every frequency Wireless Workbench finds incompatible', () => {
    for (const testCase of withReference) {
      const reference = testCase.wwbReference as WwbReference;
      // Same spacings on both sides, or the comparison means nothing.
      const result =
        testCase.mode === 'check'
          ? checkPlan({
              ...testCase.input,
              config: {
                ...testCase.input.config,
                guards: {
                  im3TwoTxKHz: reference.profile.im3TwoTx,
                  im3ThreeTxKHz: reference.profile.im3ThreeTx,
                  im5TwoTxKHz: reference.profile.im5TwoTx,
                },
              },
            })
          : run(testCase);
      const critical = result.violations.filter((v) => v.severity === 'critical');
      const victims = new Set(critical.map((v) => v.victimLinkId));
      for (const expected of reference.incompatible) {
        expect(victims, `${testCase.id} : ${expected.victimLinkId} incompatible pour WWB, rien chez EasyHF`).toContain(
          expected.victimLinkId,
        );
        if (expected.sourceLinkIds) {
          const key = [...expected.sourceLinkIds].sort().join('+');
          const sources = critical
            .filter((v) => v.victimLinkId === expected.victimLinkId)
            .map((v) => [...v.sourceLinkIds].sort().join('+'));
          expect(sources, `${testCase.id} : ${expected.victimLinkId} <= ${key}`).toContain(key);
        }
      }
    }
  });

  it.skipIf(withReference.length === 0)('records where EasyHF is stricter than Wireless Workbench', () => {
    // Over-reporting is accepted by the gate; it is still worth seeing.
    for (const testCase of withReference) {
      const reference = testCase.wwbReference as WwbReference;
      const victims = new Set(run(testCase).violations.map((v) => v.victimLinkId));
      const stricter = reference.compatible.filter((id) => victims.has(id));
      if (stricter.length > 0) {
        console.info(`${testCase.id} : EasyHF signale aussi ${stricter.join(', ')}, que WWB juge compatibles`);
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
