import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { buildGrid, freqAt, markBlocked, SCALE } from '../src/candidates.js';
import { checkPlan, distanceToInterval, requiredExclusionKHz } from '../src/check.js';
import { DEFAULT_GUARDS } from '../src/config.js';
import type { EngineExclusion, EngineLink } from '../src/types.js';

const RUNS = { numRuns: 150 };

const linkArb = (index: number): fc.Arbitrary<EngineLink> =>
  fc
    .record({
      start: fc.integer({ min: 500_000, max: 520_000 }),
      span: fc.integer({ min: 4_000, max: 40_000 }),
      stepKHz: fc.constantFrom(5, 25, 125),
      channelWidthKHz: fc.constantFrom(25, 200, 300),
      zoneId: fc.constantFrom('', 'a', 'b'),
    })
    .map(({ start, span, stepKHz, channelWidthKHz, zoneId }) => ({
      id: `HF${String(index).padStart(2, '0')}`,
      zoneId,
      tuningRangeKHz: [start, start + span] as [number, number],
      stepKHz,
      channelWidthKHz,
    }));

const linksArb = fc
  .integer({ min: 2, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => linkArb(i))));

const exclusionsArb = fc.array(
  fc
    .record({ from: fc.integer({ min: 495_000, max: 560_000 }), width: fc.integer({ min: 100, max: 8_000 }) })
    .map(
      ({ from, width }): EngineExclusion => ({
        fromKHz: from,
        toKHz: from + width,
        source: 'manual',
        label: `E${from}`,
      }),
    ),
  { maxLength: 4 },
);

describe('markBlocked (property)', () => {
  it('blocks exactly the candidates a direct comparison would block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500_000, max: 500_400 }),
        fc.integer({ min: 100, max: 2_000 }),
        fc.constantFrom(5, 25, 125),
        fc.integer({ min: -3_000, max: 3_000 }),
        fc.integer({ min: 0, max: 2_000 }),
        (start, span, step, offset, halfWidth) => {
          const grid = buildGrid(start, start + span, step);
          const mask = new Uint8Array(grid.count);
          const lo6 = SCALE * (start + offset - halfWidth) + 1;
          const hi6 = SCALE * (start + offset + halfWidth) - 1;
          markBlocked(mask, grid, lo6, hi6);
          for (let n = 0; n < grid.count; n += 1) {
            const scaled = SCALE * freqAt(grid, n);
            expect(mask[n] === 1).toBe(scaled >= lo6 && scaled <= hi6);
          }
        },
      ),
      RUNS,
    );
  });
});

describe('coordinate (property)', () => {
  it('is invariant under the order the links are given in', () => {
    fc.assert(
      fc.property(linksArb, exclusionsArb, (links, exclusions) => {
        const forward = coordinate({ links, exclusions });
        const reversed = coordinate({ links: [...links].reverse(), exclusions });
        expect(reversed).toEqual(forward);
      }),
      RUNS,
    );
  });

  it('only ever assigns frequencies on the hardware grid, inside the tuning range', () => {
    fc.assert(
      fc.property(linksArb, exclusionsArb, (links, exclusions) => {
        const byId = new Map(links.map((l) => [l.id, l]));
        for (const { linkId, freqKHz } of coordinate({ links, exclusions }).assignments) {
          const l = byId.get(linkId) as EngineLink;
          expect(freqKHz).toBeGreaterThanOrEqual(l.tuningRangeKHz[0]);
          expect(freqKHz).toBeLessThanOrEqual(l.tuningRangeKHz[1]);
          expect((freqKHz - l.tuningRangeKHz[0]) % l.stepKHz).toBe(0);
        }
      }),
      RUNS,
    );
  });

  it('keeps every assigned frequency clear of every exclusion', () => {
    fc.assert(
      fc.property(linksArb, exclusionsArb, (links, exclusions) => {
        const byId = new Map(links.map((l) => [l.id, l]));
        const result = coordinate({ links, exclusions });
        for (const { linkId, freqKHz } of result.assignments) {
          const required = requiredExclusionKHz(
            byId.get(linkId) as EngineLink,
            result.robustness.guards.exclusionKHz,
          );
          for (const exclusion of exclusions) {
            expect(distanceToInterval(freqKHz, exclusion.fromKHz, exclusion.toKHz)).toBeGreaterThanOrEqual(
              required,
            );
          }
        }
      }),
      RUNS,
    );
  });

  it('produces a plan that an independent check finds free of critical violations', () => {
    fc.assert(
      fc.property(linksArb, exclusionsArb, (links, exclusions) => {
        const result = coordinate({ links, exclusions });
        if (result.unassignedLinkIds.length > 0) return; // partial plans may conflict
        const verified = checkPlan({
          links,
          plan: result.assignments,
          exclusions,
          config: { guards: result.robustness.guards },
        });
        expect(verified.violations.filter((v) => v.severity === 'critical')).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe('checkPlan (property)', () => {
  it('does not depend on the order of links, plan entries or exclusions', () => {
    fc.assert(
      fc.property(linksArb, exclusionsArb, fc.array(fc.integer({ min: 500_000, max: 540_000 })), (links, exclusions, freqs) => {
        const plan = links.map((l, i) => ({
          linkId: l.id,
          freqKHz: freqs[i % Math.max(freqs.length, 1)] ?? 510_000,
        }));
        const forward = checkPlan({ links, plan, exclusions, config: { guards: DEFAULT_GUARDS } });
        const reversed = checkPlan({
          links: [...links].reverse(),
          plan: [...plan].reverse(),
          exclusions: [...exclusions].reverse(),
          config: { guards: DEFAULT_GUARDS },
        });
        expect(reversed.violations).toEqual(forward.violations);
        expect(reversed.margins).toEqual(forward.margins);
      }),
      RUNS,
    );
  });
});
