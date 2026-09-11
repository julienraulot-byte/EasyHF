import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import { FR_BANDS, tntChannel } from './fixtures/links.js';
import type {
  EngineBand,
  EngineConfigInput,
  EngineExclusion,
  EngineLink,
  Guards,
  InterZonePolicy,
  ZonePolicies,
} from '../src/types.js';

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

/** A locked 6 MHz WMAS block. */
function block(id: string, zoneId: string, freqKHz: number): EngineLink {
  return { ...pinned(id, zoneId, freqKHz, 125), kind: 'wmas', channelWidthKHz: 6_000 };
}
const FREE_BLOCK: Partial<EngineLink> = { kind: 'wmas', channelWidthKHz: 6_000, stepKHz: 125 };
/** Three zones, each policy represented once. */
const POLICIES_MIXED: ZonePolicies = { a: 'full-intermod', b: 'spacing-only', c: 'isolated' };

/** Guard sets a hardware entry might carry, from Shure's loosest to ours. */
const GUARD_SETS: (Partial<Guards> | undefined)[] = [
  undefined,
  { im3TwoTxKHz: 75, im3ThreeTxKHz: 0, im5TwoTxKHz: 0, spacingKHz: 350 },
  { im3TwoTxKHz: 150, im3ThreeTxKHz: 0, im5TwoTxKHz: 0, spacingKHz: 350 },
  { im3TwoTxKHz: 200, im3ThreeTxKHz: 150, im5TwoTxKHz: 0, spacingKHz: 125 },
  { im3TwoTxKHz: 50, im3ThreeTxKHz: 50, im5TwoTxKHz: 40, spacingKHz: 60, exclusionKHz: 100 },
];

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
  statics: {
    exclusions?: EngineExclusion[];
    bands?: EngineBand[];
    freeGuards?: Partial<Guards>;
    /** Shape of the free link, e.g. a wideband block. */
    freeLink?: Partial<EngineLink>;
  } = {},
): { accepted: number; rejected: number } {
  let accepted = 0;
  let rejected = 0;
  const merged = { ...NOMINAL, ...config };
  const { freeGuards, freeLink, ...spectrum } = statics;

  for (const freqKHz of candidates) {
    const free: EngineLink = {
      id: 'FREE',
      zoneId: zoneOfFreeLink,
      tuningRangeKHz: [freqKHz, freqKHz],
      stepKHz: 25,
      channelWidthKHz: 200,
      ...(freeGuards ? { guards: freeGuards } : {}),
      ...freeLink,
    };
    const links = [...locked, free];
    const search = coordinate({ links, zonePolicies, config: merged, ...spectrum });
    const searchAccepted = search.unassignedLinkIds.length === 0;

    const verdict = checkPlan({
      links,
      plan: [
        ...locked.map((l) => ({ linkId: l.id, freqKHz: l.lockedFreqKHz as number })),
        { linkId: 'FREE', freqKHz },
      ],
      zonePolicies,
      config: merged,
      ...spectrum,
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

/** A scenario that only ever accepts, or only ever rejects, has tested nothing. */
function bothOutcomes(counts: { accepted: number; rejected: number }, label: string): void {
  expect(counts.accepted, `${label} : aucune fréquence acceptée`).toBeGreaterThan(0);
  expect(counts.rejected, `${label} : aucune fréquence refusée`).toBeGreaterThan(0);
}

describe('assignment and checking agree, candidate by candidate', () => {
  it('in a single zone', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'a', 506_000), pinned('L3', 'a', 511_300)];
    bothOutcomes(crossValidate(locked, grid(494_000, 800), {}, 'a', {}), 'une zone');
  });

  it('across three zones under every combination of policies, from every zone', () => {
    // The cases that matter: with one zone fully coupled and the others not, a
    // product can reach a victim through carriers the link being placed cannot
    // see, and a product can hit one of its own generators with no other rule
    // left to cover it.
    const policies: InterZonePolicy[] = ['full-intermod', 'spacing-only', 'isolated'];
    for (const a of policies) {
      for (const b of policies) {
        for (const c of policies) {
          for (const freeZone of ['a', 'b', 'c']) {
            const locked = [pinned('LA', 'a', 500_000), pinned('LB', 'b', 520_000), pinned('LC', 'c', 507_400)];
            bothOutcomes(
              crossValidate(locked, grid(499_000, 900), { a, b, c }, freeZone, {}),
              `${a}/${b}/${c}, libre en ${freeZone}`,
            );
          }
        }
      }
    }
  });

  it('with exclusions and a band plan in force', () => {
    const locked = [pinned('L1', 'a', 530_000), pinned('L2', 'b', 553_000), pinned('L3', 'a', 561_100)];
    bothOutcomes(
      crossValidate(locked, grid(524_000, 1_600), { a: 'full-intermod', b: 'spacing-only' }, 'a', {}, {
        exclusions: [tntChannel(29), tntChannel(31)],
        bands: FR_BANDS,
      }),
      'exclusions et bandes',
    );
    // Straddling the 694 MHz band edge and the forbidden 700 MHz band.
    const high = [pinned('H1', 'a', 690_000), pinned('H2', 'a', 692_000)];
    bothOutcomes(
      crossValidate(high, grid(688_000, 400), {}, 'a', {}, { bands: FR_BANDS }),
      'bord de bande',
    );
  });

  it('with mixed tuning grids and channel widths', () => {
    const locked = [
      { ...pinned('L1', 'a', 500_000, 5), channelWidthKHz: 25 },
      { ...pinned('L2', 'a', 503_125, 125), channelWidthKHz: 300 },
      { ...pinned('L3', 'b', 508_000), channelWidthKHz: 800 },
    ];
    bothOutcomes(
      crossValidate(locked, grid(496_000, 600), { a: 'full-intermod', b: 'spacing-only' }, 'a', {}),
      'grilles mélangées',
    );
  });

  it('with the higher-order products switched off', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'a', 506_000), pinned('L3', 'a', 509_100)];
    for (const config of [
      { enableIm3ThreeTx: false },
      { enableIm5TwoTx: false },
      { enableIm3ThreeTx: false, enableIm5TwoTx: false },
    ]) {
      bothOutcomes(crossValidate(locked, grid(495_000, 400), {}, 'a', config), JSON.stringify(config));
    }
  });

  it('with per-model guards mixed across carriers and zones', () => {
    // Every combination of guard sets over three locked carriers and the free
    // link, in the topology where a product may only be covered by a rule that
    // runs with a smaller guard than the victim's own.
    for (const [ga, gb, gc, gf] of [
      [GUARD_SETS[1], GUARD_SETS[1], GUARD_SETS[3], GUARD_SETS[0]],
      [GUARD_SETS[3], GUARD_SETS[1], GUARD_SETS[1], GUARD_SETS[4]],
      [GUARD_SETS[4], GUARD_SETS[4], GUARD_SETS[0], GUARD_SETS[3]],
      [GUARD_SETS[2], GUARD_SETS[0], GUARD_SETS[4], GUARD_SETS[1]],
    ]) {
      const locked = [
        { ...pinned('LA', 'a', 500_000), ...(ga ? { guards: ga } : {}) },
        { ...pinned('LB', 'b', 520_000), ...(gb ? { guards: gb } : {}) },
        { ...pinned('LC', 'c', 507_400, 5), channelWidthKHz: 25, ...(gc ? { guards: gc } : {}) },
      ];
      for (const policies of [
        { a: 'full-intermod', b: 'full-intermod', c: 'full-intermod' },
        { a: 'spacing-only', b: 'full-intermod', c: 'spacing-only' },
        { a: 'isolated', b: 'full-intermod', c: 'isolated' },
      ] as ZonePolicies[]) {
        for (const freeZone of ['a', 'b']) {
          bothOutcomes(
            crossValidate(locked, grid(499_000, 900), policies, freeZone, {}, gf ? { freeGuards: gf } : {}),
            `gardes ${JSON.stringify([ga, gb, gc, gf])}, ${JSON.stringify(policies)}, libre en ${freeZone}`,
          );
        }
      }
    }
  });

  it('with a wideband block among the locked carriers, whether or not it generates', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'b', 503_400), pinned('L3', 'a', 507_125), block('S', 'a', 520_000)];
    for (const wmasAsImGenerator of [false, true]) {
      for (const zone of ['a', 'b']) {
        // Beyond the block, where its products (when it generates) and its
        // edge spacing land; and around the narrowband carriers.
        const counts = crossValidate(locked, [...grid(495_000, 120, 125), ...grid(522_000, 200, 125)], POLICIES_MIXED, zone, { wmasAsImGenerator });
        bothOutcomes(counts, `bloc verrouillé, zone ${zone}, générateur ${wmasAsImGenerator}`);
      }
    }
  });

  it('with the free link being a wideband block', () => {
    const locked = [pinned('L1', 'a', 500_000), pinned('L2', 'b', 503_400), pinned('L3', 'c', 507_125), pinned('L4', 'a', 511_000)];
    for (const wmasAsImGenerator of [false, true]) {
      for (const zone of ['a', 'c']) {
        const counts = crossValidate(locked, grid(474_000, 520, 125), POLICIES_MIXED, zone, { wmasAsImGenerator }, {
          freeLink: FREE_BLOCK,
          exclusions: [tntChannel(23)],
          bands: FR_BANDS,
        });
        bothOutcomes(counts, `bloc libre, zone ${zone}, générateur ${wmasAsImGenerator}`);
      }
    }
  });

  it('with two blocks and the free link narrowband, blocks generating', () => {
    const locked = [block('S1', 'a', 500_000), block('S2', 'b', 512_000), pinned('L1', 'a', 520_000)];
    const counts = crossValidate(locked, grid(470_000, 720, 125), POLICIES_MIXED, 'a', { wmasAsImGenerator: true });
    bothOutcomes(counts, 'deux blocs générateurs');
  });

  it('on randomly generated scenes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            freqKHz: fc.integer({ min: 20_000, max: 20_999 }).map((k) => 500_000 + k * 10),
            zoneId: fc.constantFrom('a', 'b', 'c'),
            guardSet: fc.integer({ min: 0, max: GUARD_SETS.length - 1 }),
            // One carrier in six is a wideband block.
            wmas: fc.integer({ min: 0, max: 5 }).map((k) => k === 0),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        fc.record({
          a: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
          b: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
          c: fc.constantFrom<InterZonePolicy>('full-intermod', 'spacing-only', 'isolated'),
        }),
        fc.constantFrom('a', 'b', 'c'),
        fc.integer({ min: 0, max: GUARD_SETS.length - 1 }),
        fc.boolean(),
        fc.boolean(),
        (carriers, zonePolicies, freeZone, freeGuardSet, freeIsBlock, wmasAsImGenerator) => {
          const locked = carriers.map((carrier, i) => {
            const guards = GUARD_SETS[carrier.guardSet];
            const base = carrier.wmas ? block(`L${i + 1}`, carrier.zoneId, carrier.freqKHz) : pinned(`L${i + 1}`, carrier.zoneId, carrier.freqKHz);
            return { ...base, ...(guards ? { guards } : {}) };
          });
          const unique = new Map(locked.map((l) => [l.lockedFreqKHz, l]));
          const freeGuards = GUARD_SETS[freeGuardSet];
          crossValidate([...unique.values()], grid(700_000, 200), zonePolicies, freeZone, { wmasAsImGenerator }, {
            ...(freeGuards ? { freeGuards } : {}),
            ...(freeIsBlock ? { freeLink: FREE_BLOCK } : {}),
          });
        },
      ),
      { numRuns: 25 },
    );
  });
});
