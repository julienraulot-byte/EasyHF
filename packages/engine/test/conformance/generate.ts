/**
 * Generates the conformance corpus the Kotlin port will be held to (D-032).
 *
 *   pnpm --filter @easyhf/engine corpus
 *
 * Ten golden files proved nothing about a numerical engine: one load case, one
 * band plan, one tuning grid. This walks the whole input space instead — block
 * widths, tuning grids of 5, 25 and 125 kHz, ranges up to 1.8 GHz, guards
 * including zeros, holes in bands, locked carriers, three zone policies,
 * exclusions, band plans, and every configuration toggle.
 *
 * The file it writes is the artifact, not this script: the Kotlin engine reads
 * the same inputs and must produce the same outputs, field for field. Nothing
 * in it is a sentence, so a port reproduces numbers rather than characters.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coordinate } from '../../src/assign.js';
import { checkPlan } from '../../src/check.js';
import type { CoordinateInput, EngineBand, EngineLink, Guards, InterZonePolicy } from '../../src/types.js';

/** xorshift32: same sequence everywhere, which `Math.random` would not be. */
function rng(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const GUARD_SETS: (Partial<Guards> | undefined)[] = [
  undefined,
  { im3TwoTxKHz: 75, im3ThreeTxKHz: 0, im5TwoTxKHz: 0, spacingKHz: 350 },
  { im3TwoTxKHz: 200, im3ThreeTxKHz: 150, im5TwoTxKHz: 0, spacingKHz: 125 },
  { im3TwoTxKHz: 0, im3ThreeTxKHz: 0, im5TwoTxKHz: 0, spacingKHz: 400 },
  { im3TwoTxKHz: 50, im3ThreeTxKHz: 50, im5TwoTxKHz: 40, spacingKHz: 60, exclusionKHz: 0 },
  { im3TwoTxKHz: 400, im3ThreeTxKHz: 300, im5TwoTxKHz: 200, spacingKHz: 500, exclusionKHz: 1000 },
];

/** Plausible spectrum, including the 1.4 GHz band where 32-bit ints get tight. */
const SPANS: [number, number][] = [
  [470_000, 534_000],
  [606_000, 694_000],
  [823_000, 832_000],
  [1_350_000, 1_400_000],
  [1_785_000, 1_800_000],
];

const BAND_PLANS: (EngineBand[] | undefined)[] = [
  undefined,
  [
    { fromKHz: 470_000, toKHz: 694_000, status: 'free' },
    { fromKHz: 694_000, toKHz: 790_000, status: 'forbidden' },
    { fromKHz: 823_000, toKHz: 832_000, status: 'free' },
    { fromKHz: 1_350_000, toKHz: 1_400_000, status: 'temporary' },
    { fromKHz: 1_785_000, toKHz: 1_800_000, status: 'free' },
  ],
];

const POLICIES: InterZonePolicy[] = ['full-intermod', 'spacing-only', 'isolated'];
const STEPS = [5, 25, 125];

function scene(random: () => number, index: number): CoordinateInput {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const between = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  const tight = random() < 0.5;

  const zoneCount = between(1, 3);
  const zonePolicies: Record<string, InterZonePolicy> = {};
  for (let z = 0; z < zoneCount; z += 1) zonePolicies[`z${z}`] = pick(POLICIES);

  const links: EngineLink[] = [];
  for (let i = 0; i < between(2, 8); i += 1) {
    const [lo, hi] = pick(SPANS);
    const stepKHz = pick(STEPS);
    const isBlock = random() < 0.12 && hi - lo > 20_000;
    const width = isBlock ? pick([6_000, 8_000]) : pick([25, 200, 300]);
    // Keep the range on the grid and wide enough to hold the carrier.
    const spanFrom = lo + between(0, 40) * stepKHz;
    // Half the scenes are cramped, so the robustness ladder has to descend and
    // some links go unplaced — states a corpus of easy scenes never reaches.
    const room = Math.floor((hi - spanFrom) / stepKHz);
    const widest = tight ? Math.min(room, Math.max(isBlock ? 400 : 24, Math.floor(room / 8))) : room;
    const spanTo = spanFrom + between(isBlock ? 400 : 20, Math.max(widest, isBlock ? 400 : 20)) * stepKHz;
    const guards = pick(GUARD_SETS);
    const link: EngineLink = {
      id: `L${index}_${i}`,
      zoneId: `z${between(0, zoneCount - 1)}`,
      tuningRangeKHz: [spanFrom, spanTo],
      stepKHz,
      channelWidthKHz: width,
      ...(isBlock ? { kind: 'wmas' as const } : {}),
      ...(guards ? { guards } : {}),
    };
    // One link in eight carries holes; one in six is locked in place.
    if (!isBlock && random() < 0.125 && spanTo - spanFrom > 8 * stepKHz) {
      const quarter = Math.floor((spanTo - spanFrom) / (4 * stepKHz)) * stepKHz;
      link.tunableRangesKHz = [
        [spanFrom, spanFrom + quarter],
        [spanFrom + 3 * quarter, spanTo],
      ];
    }
    // A third of carriers are locked, and locked ones cluster near the bottom
    // of the range: that is what puts products on top of each other.
    if (random() < 0.33) {
      const steps = Math.floor((spanTo - spanFrom) / stepKHz);
      link.lockedFreqKHz = spanFrom + between(0, Math.max(1, Math.floor(steps / 8))) * stepKHz;
    }
    links.push(link);
  }

  const exclusions = Array.from({ length: between(0, 3) }, (_, e) => {
    const from = between(470_000, 690_000);
    return { fromKHz: from, toKHz: from + between(0, 8_000), source: 'manual' as const, label: `X${e}` };
  });

  return {
    links,
    exclusions,
    zonePolicies,
    ...(pick(BAND_PLANS) ? { bands: pick(BAND_PLANS) as EngineBand[] } : {}),
    config: {
      enableIm3ThreeTx: random() < 0.8,
      enableIm5TwoTx: random() < 0.7,
      allowTemporaryBands: random() < 0.5,
      wmasAsImGenerator: random() < 0.3,
      placementStrategy: random() < 0.5 ? 'compact' : 'spread',
      maxBacktrackSteps: pick([0, 10, 50]),
      guards: pick(GUARD_SETS.slice(1)) as Partial<Guards>,
    },
  };
}

export interface CorpusCase {
  /**
   * `coordinate` replays the search; `check` replays the verdict on a plan the
   * search did not produce. Both halves of the engine are ported, so both are
   * held to the corpus — and a plan drawn at random hits far more violations
   * than a plan the search has already made valid.
   */
  kind: 'coordinate' | 'check';
  input: CoordinateInput;
  /** Only for `check` cases: the frequencies to verify. */
  plan?: { linkId: string; freqKHz: number }[];
  /** The whole result but `engineVersion`, which is not a computed value. */
  output: unknown;
}

export function buildCorpus(count: number, seed = 0xEA5F1): CorpusCase[] {
  const random = rng(seed);
  const cases: CorpusCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const input = scene(random, i);
    try {
      const { engineVersion: _ignored, ...output } = coordinate(input);
      cases.push({ kind: 'coordinate', input, output });
    } catch {
      // A scene the engine refuses is not a conformance case; skip it rather
      // than freeze an error message, which is prose again.
      continue;
    }
    // The same scene, verified on a plan drawn at random on each link's grid.
    const plan = input.links.map((link) => {
      const [from, to] = link.tuningRangeKHz;
      const steps = Math.floor((to - from) / link.stepKHz);
      const onGrid = from + Math.floor(random() * (steps + 1)) * link.stepKHz;
      const draw = random();
      // A plan arriving from a file or a human is not always on the grid, nor
      // always in range; the checker's own faults deserve cases too.
      if (draw < 0.06) return { linkId: link.id, freqKHz: onGrid + 1 };
      if (draw < 0.1) return { linkId: link.id, freqKHz: to + link.stepKHz };
      return { linkId: link.id, freqKHz: onGrid };
    });
    const { engineVersion: _also, ...verdict } = checkPlan({
      links: input.links,
      plan,
      ...(input.exclusions ? { exclusions: input.exclusions } : {}),
      ...(input.bands ? { bands: input.bands } : {}),
      ...(input.zonePolicies ? { zonePolicies: input.zonePolicies } : {}),
      ...(input.config ? { config: input.config } : {}),
    });
    cases.push({ kind: 'check', input, plan, output: verdict });
  }
  return cases;
}

const COUNT = Number(process.env.CORPUS_SIZE ?? 400);
const cases = buildCorpus(COUNT);
const path = fileURLToPath(new URL('./corpus.json', import.meta.url));
writeFileSync(path, `${JSON.stringify(cases)}\n`);
console.log(`${cases.length} cas écrits sur ${COUNT} scènes, ${(JSON.stringify(cases).length / 1024 / 1024).toFixed(2)} Mio.`);
