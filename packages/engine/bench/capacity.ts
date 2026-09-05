/**
 * Capacity and cost measurements behind the defaults recorded in
 * `docs/DECISIONS.md`. Run with `pnpm --filter @easyhf/engine bench`.
 *
 * Not a test: it prints numbers for a human to read, and takes a minute or two.
 */
import { coordinate } from '../src/index.js';
import type { EngineBand, EngineLink, PlacementStrategy } from '../src/types.js';

const BANDS: EngineBand[] = [{ fromKHz: 470_000, toKHz: 694_000, status: 'free' }];

const links = (count: number): EngineLink[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `HF${String(i + 1).padStart(2, '0')}`,
    zoneId: '',
    tuningRangeKHz: [470_000, 694_000],
    stepKHz: 25,
    channelWidthKHz: 200,
  }));

function placed(im3ThreeTxKHz: number, placementStrategy: PlacementStrategy, maxBacktrackSteps: number): number {
  return coordinate({
    links: links(80),
    bands: BANDS,
    config: {
      guards: { im3ThreeTxKHz },
      robustnessLadder: [1],
      maxBacktrackSteps,
      placementStrategy,
    },
  }).assignments.length;
}

console.log('Liaisons placées à gardes nominales — 470–694 MHz, pas 25 kHz, canal 200 kHz');
console.log('IM3 2tx 200 kHz · IM5 90 kHz · espacement 300 kHz · 200 retours arrière\n');
console.log('garde IM3 3tx | compact | spread');
for (const guard of [200, 150, 100, 75, 50, 25]) {
  console.log(
    `${String(guard).padStart(9)} kHz | ${String(placed(guard, 'compact', 200)).padStart(7)} | ${String(placed(guard, 'spread', 200)).padStart(6)}`,
  );
}

console.log('\nRendement des retours arrière — 40 liaisons, gardes nominales, placement compact');
console.log('budget | liaisons placées | durée');
for (const budget of [0, 200, 2_000, 20_000]) {
  const started = Date.now();
  const result = coordinate({
    links: links(40),
    bands: BANDS,
    config: { robustnessLadder: [1], maxBacktrackSteps: budget },
  });
  console.log(
    `${String(budget).padStart(6)} | ${String(result.assignments.length).padStart(16)} | ${Date.now() - started} ms`,
  );
}
