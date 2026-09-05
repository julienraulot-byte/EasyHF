import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import type { EngineConfigInput, EngineLink, InterZonePolicy, ZonePolicies } from '../src/types.js';

/**
 * The assignment search and the plan checker encode the same rules twice:
 * `assign.ts` solves each product for the unknown carrier and blocks intervals,
 * `check.ts` enumerates products and measures distances. Nothing forces them to
 * agree — and when they drift, `coordinate` returns a plan it then declares
 * invalid, which is the worst outcome short of a silent one.
 *
 * So the two are compared exhaustively rather than spot-checked: every single
 * frequency a link could take is offered to the search, and the verdict is
 * matched against the checker's. This is the test that catches a visibility or
 * an arithmetic mistake; the unit tests around it only catch the ones someone
 * thought to write down.
 */
const NOMINAL: EngineConfigInput = { robustnessLadder: [1], maxBacktrackSteps: 0 };

function pinned(id: string, zoneId: string, freqKHz: number, stepKHz = 25): EngineLink {
  return {
    id,
    zoneId,
    tuningRangeKHz: [freqKHz, freqKHz],
    stepKHz,
    channelWidthKHz: 200,
    lockedFreqKHz: freqKHz,
  };
}

/**
 * Offers every candidate frequency to the search one at a time, and requires
 * the search to accept exactly those the checker finds free of critical
 * violations.
 */
function crossValidate(
  locked: EngineLink[],
  candidates: number[],
  zonePolicies: ZonePolicies,
  zoneOfFreeLink: string,
  config: EngineConfigInput,
): { accepted: number; rejected: number } {
  let accepted = 0;
  let rejected = 0;
  const merged = { ...NOMINAL, ...config };

  for (const freqKHz of candidates) {
    const free: EngineLink = {
      id: 'FREE',
      zoneId: zoneOfFreeLink,
      tuningRangeKHz: [freqKHz, freqKHz],
      stepKHz: 25,
      channelWidthKHz: 200,
    };
    const links = [...locked, free];
    const search = coordinate({ links, zonePolicies, config: merged });
    const searchAccepted = search.unassignedLinkIds.length === 0;

    const verdict = checkPlan({
      links,
      plan: [
        ...locked.map((l) => ({ linkId: l.id, freqKHz: l.lockedFreqKHz as number })),
        { linkId: 'FREE', freqKHz },
      ],
      zonePolicies,
      config: merged,
    });
    // Only violations the free link takes part in: a conflict between two
    // locked carriers is not something the search can act on, and the mask
    // never claims otherwise.
    const checkerAccepted = !verdict.violations.some(
      (v) =>
        v.severity === 'critical' &&
        (v.victimLinkId === 'FREE' || v.sourceLinkIds.includes('FREE')),
    );

    expect(
      searchAccepted,
      `${freqKHz} kHz : la recherche ${searchAccepted ? 'accepte' : 'refuse'}, ` +
        `le vérificateur ${checkerAccepted ? 'accepte' : 'refuse'}` +
        (checkerAccepted
          ? ''
          : ` (${verdict.violations.find((v) => v.victimLinkId === 'FREE' || v.sourceLinkIds.includes('FREE'))?.message})`),
    ).toBe(checkerAccepted);

    if (searchAccepted) accepted += 1;
    else rejected += 1;
  }
  return { accepted, rejected };
}

const grid = (from: number, count: number, step = 25) =>
  Array.from({ length: count }, (_, i) => from + i * step);

describe('assignment and checking agree, candidate by candidate', () => {
  it('in a single zone', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'a', 506_000), pinned('L3', 'a', 511_300)];
    const { accepted, rejected } = crossValidate(locked, grid(494_000, 800), {}, 'a', {});
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it('across three zones under every combination of policies', () => {
    // The case that matters: with B fully coupled and A, C not, a product can
    // reach a victim in B through carriers the link being placed cannot see.
    const policies: InterZonePolicy[] = ['full-intermod', 'spacing-only', 'isolated'];
    for (const a of policies) {
      for (const b of policies) {
        for (const c of policies) {
          const locked = [
            pinned('LA', 'a', 500_000),
            pinned('LB', 'b', 520_000),
            pinned('LC', 'c', 507_400),
          ];
          crossValidate(locked, grid(505_000, 400), { a, b, c }, 'a', {});
        }
      }
    }
  });

  it('with mixed tuning grids and channel widths', () => {
    const locked = [
      { ...pinned('L1', 'a', 500_000, 5), channelWidthKHz: 25 },
      { ...pinned('L2', 'a', 503_125, 125), channelWidthKHz: 300 },
      { ...pinned('L3', 'b', 508_000), channelWidthKHz: 800 },
    ];
    crossValidate(locked, grid(496_000, 600), { a: 'full-intermod', b: 'spacing-only' }, 'a', {});
  });

  it('with the higher-order products switched off', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'a', 506_000), pinned('L3', 'a', 509_100)];
    for (const config of [
      { enableIm3ThreeTx: false },
      { enableIm5TwoTx: false },
      { enableIm3ThreeTx: false, enableIm5TwoTx: false },
    ]) {
      crossValidate(locked, grid(495_000, 400), {}, 'a', config);
    }
  });

  it('on randomly generated scenes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            freqKHz: fc.integer({ min: 20_000, max: 20_999 }).map((k) => 500_000 + k * 10),
            zoneId: fc.constantFrom('a', 'b', 'c'),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        fc.record({
          a: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
          b: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
          c: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
        }),
        fc.constantFrom('a', 'b', 'c'),
        (carriers, zonePolicies, freeZone) => {
          const locked = carriers.map((carrier, i) =>
            pinned(`L${i + 1}`, carrier.zoneId, carrier.freqKHz),
          );
          const unique = new Map(locked.map((l) => [l.lockedFreqKHz, l]));
          crossValidate([...unique.values()], grid(700_000, 200), zonePolicies, freeZone, {});
        },
      ),
      { numRuns: 25 },
    );
  });
});
