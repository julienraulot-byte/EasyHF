/**
 * Candidate grids.
 *
 * A link can only be tuned to `from + n · step`, so assignment works on a dense
 * boolean mask indexed by `n` rather than on interval lists: marking a blocked
 * span costs one integer range fill, and testing a candidate costs one lookup.
 *
 * Interval bounds coming from intermodulation are sixths of a kHz (products are
 * divided by 2 or 3 when solved for the unknown carrier), so every bound is
 * carried as an exact integer in units of 1/6 kHz. No float ever decides
 * whether a candidate is blocked — that is what makes runs bit-reproducible.
 */

import type { PlacementStrategy } from './types.js';

export const SCALE = 6;

export interface CandidateGrid {
  /** Lowest tunable frequency, kHz. */
  baseKHz: number;
  /** Tuning step, kHz. */
  stepKHz: number;
  /** Number of tunable points. */
  count: number;
}

export function buildGrid(fromKHz: number, toKHz: number, stepKHz: number): CandidateGrid {
  if (!Number.isInteger(fromKHz) || !Number.isInteger(toKHz)) {
    throw new Error(`Plage d'accord non entière : ${fromKHz}–${toKHz} kHz`);
  }
  if (!Number.isInteger(stepKHz) || stepKHz <= 0) {
    throw new Error(`Pas d'accord invalide : ${stepKHz} kHz (entier > 0 attendu)`);
  }
  if (toKHz < fromKHz) {
    throw new Error(`Plage d'accord inversée : ${fromKHz}–${toKHz} kHz`);
  }
  return { baseKHz: fromKHz, stepKHz, count: Math.floor((toKHz - fromKHz) / stepKHz) + 1 };
}

export function freqAt(grid: CandidateGrid, index: number): number {
  return grid.baseKHz + index * grid.stepKHz;
}

/**
 * Blocks every candidate whose scaled frequency lies in the closed range
 * `[lo6, hi6]`, both expressed in units of 1/6 kHz.
 *
 * Callers model *open* constraints (`|f − x| < guard`) by passing
 * `lo6 = 6·(x − guard) + 1` and `hi6 = 6·(x + guard) − 1`, which excludes the
 * exactly-at-the-guard frequency without any rounding.
 */
export function markBlocked(
  mask: Uint8Array,
  grid: CandidateGrid,
  lo6: number,
  hi6: number,
): void {
  if (hi6 < lo6) return;
  const base6 = SCALE * grid.baseKHz;
  const step6 = SCALE * grid.stepKHz;
  let start = Math.ceil((lo6 - base6) / step6);
  let end = Math.floor((hi6 - base6) / step6);
  if (start < 0) start = 0;
  if (end > grid.count - 1) end = grid.count - 1;
  if (start <= end) mask.fill(1, start, end + 1);
}

/**
 * `markBlocked` with the grid's scaled constants hoisted out of the loop.
 *
 * The assignment search calls this on the order of a million times per plan —
 * once per (victim, source, source) triple — so the per-call property lookups
 * and multiplications are worth removing.
 */
export function blockerFor(mask: Uint8Array, grid: CandidateGrid) {
  const base6 = SCALE * grid.baseKHz;
  const step6 = SCALE * grid.stepKHz;
  const last = grid.count - 1;
  /** Blocks the closed scaled range `[lo6, hi6]`, in units of 1/6 kHz. */
  const range = (lo6: number, hi6: number): void => {
    let start = Math.ceil((lo6 - base6) / step6);
    if (start < 0) start = 0;
    let end = Math.floor((hi6 - base6) / step6);
    if (end > last) end = last;
    if (start <= end) mask.fill(1, start, end + 1);
  };
  return {
    range,
    /** Blocks the open constraint `|f − centreKHz| < guardKHz`. */
    around: (centreKHz: number, guardKHz: number): void =>
      range(SCALE * (centreKHz - guardKHz) + 1, SCALE * (centreKHz + guardKHz) - 1),
  };
}

/**
 * For each free candidate, the distance in grid steps to the nearest blocked
 * candidate (or past the edge of the range). Two linear sweeps.
 *
 * Used to place a link in the middle of the widest usable gap rather than at
 * its lower edge — the plan then degrades gracefully when a real transmitter
 * drifts or an unplanned source appears.
 */
export function clearanceProfile(mask: Uint8Array, count: number): Int32Array {
  const clearance = new Int32Array(count);
  let run = 0;
  for (let n = 0; n < count; n += 1) {
    run = mask[n] === 1 ? 0 : run + 1;
    clearance[n] = run;
  }
  run = 0;
  for (let n = count - 1; n >= 0; n -= 1) {
    run = mask[n] === 1 ? 0 : run + 1;
    if (run < (clearance[n] as number)) clearance[n] = run;
  }
  return clearance;
}

/**
 * Free candidate indices, best first.
 *
 * `compact` packs from the bottom of the range; `spread` orders by descending
 * clearance then ascending frequency. Both are total orders, so the same input
 * always yields the same list.
 */
export function orderCandidates(
  mask: Uint8Array,
  grid: CandidateGrid,
  strategy: PlacementStrategy,
): number[] {
  const free: number[] = [];
  for (let n = 0; n < grid.count; n += 1) if (mask[n] === 0) free.push(n);
  if (strategy === 'compact') return free;
  const clearance = clearanceProfile(mask, grid.count);
  return free.sort(
    (a, b) => (clearance[b] as number) - (clearance[a] as number) || a - b,
  );
}
