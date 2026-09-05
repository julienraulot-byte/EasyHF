/**
 * Intermodulation product enumeration.
 *
 * All products are odd-order combinations whose coefficients sum to 1, so a
 * product always lands in the same band as its generators:
 *
 *   IM3, 2 transmitters:  2·f1 − f2
 *   IM3, 3 transmitters:  f1 + f2 − f3
 *   IM5, 2 transmitters:  3·f1 − 2·f2
 *
 * Even-order products (f1 ± f2) fall far outside the operating band and are
 * filtered by the receiver front-end; they are deliberately not modelled.
 */

import type { Relation } from './zones.js';

export type ImKind = 'im3-2tx' | 'im3-3tx' | 'im5-2tx';

export interface ImHit {
  kind: ImKind;
  /** Generating carriers, in coefficient order. */
  sourceIndices: number[];
  /** Coefficients, parallel to `sourceIndices`. */
  coefficients: number[];
  productKHz: number;
  /** Carrier the product falls on top of. */
  victimIndex: number;
  /** `|productKHz − victimFreqKHz|`. */
  distanceKHz: number;
  /** Guard that was breached. */
  requiredKHz: number;
}

export interface ImOptions {
  im3TwoTxKHz: number;
  im3ThreeTxKHz: number;
  im5TwoTxKHz: number;
  enableIm3ThreeTx: boolean;
  enableIm5TwoTx: boolean;
  /**
   * How two carriers constrain each other (see `zones.ts`). A product counts
   * against a victim only when every generator is `full` with it. Symmetric,
   * and `full` for a carrier with itself.
   */
  relation: (a: number, b: number) => Relation;
}

/*
 * When the victim is one of the generators
 * ----------------------------------------
 * Substituting a generator for the victim turns `P − f_v` into a combination
 * whose coefficients sum to zero, and each such residual is a quantity some
 * other rule already measures — usually harder:
 *
 *   2·f1 − f2    vs f1  →  |f1 − f2|         carrier spacing (f1, f2)
 *   2·f1 − f2    vs f2  →  2·|f1 − f2|       carrier spacing (f1, f2)
 *   3·f1 − 2·f2  vs f1  →  2·|f1 − f2|       carrier spacing (f1, f2)
 *   3·f1 − 2·f2  vs f2  →  3·|f1 − f2|       carrier spacing (f1, f2)
 *   f1 + f2 − f3 vs f1  →  |f2 − f3|         carrier spacing (f2, f3)
 *   f1 + f2 − f3 vs f3  →  |f1 + f2 − 2·f3|  the 2-transmitter product 2·f3 − f1
 *                                            measured against f2
 *
 * Reporting the case here as well would name the same anomaly twice. So it is
 * skipped — **but only when the covering rule actually runs**. Within one zone
 * it always does. Across zones it may not: spacing is skipped between
 * `isolated` zones, and the 2-transmitter form needs f2 to see f1, which the
 * 3-transmitter form never asked for. In those cases nothing else will report
 * the product, so it is reported here, under its own name.
 *
 * For the 2-transmitter families the covering rule is spacing between the two
 * generators, which always runs when they can see each other at all — and a
 * product only counts when they can. So those are skipped unconditionally.
 * `resolveConfig` keeps the guards ordered so that "covered" also means
 * "covered at least as strictly".
 */

/** Index of the first element of `sorted` that is >= `value`. */
function lowerBound(sorted: Float64Array, length: number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Walks every intermodulation product of `freqs` that lands within its guard of
 * another carrier, and reports it through `emit`.
 *
 * Hits are emitted in a fixed order (IM3 2-tx, then IM3 3-tx, then IM5 2-tx,
 * each by ascending generator index) so that results are reproducible.
 */
export function forEachImHit(
  freqs: readonly number[],
  options: ImOptions,
  emit: (hit: ImHit) => void,
): void {
  const n = freqs.length;
  if (n < 2) return;
  const { relation } = options;
  const sees = (victim: number, source: number): boolean => relation(victim, source) === 'full';

  // Victims indexed by ascending frequency, so each product only has to look at
  // the handful of carriers inside its guard window.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (freqs[a] as number) - (freqs[b] as number) || a - b,
  );
  const sorted = new Float64Array(n);
  for (let k = 0; k < n; k += 1) sorted[k] = freqs[order[k] as number] as number;

  const forEachVictim = (
    product: number,
    guard: number,
    skip: (victim: number) => boolean,
    visit: (victim: number, distance: number) => void,
  ): void => {
    let k = lowerBound(sorted, n, product - guard);
    for (; k < n; k += 1) {
      const victimFreq = sorted[k] as number;
      if (victimFreq > product + guard) break;
      const victim = order[k] as number;
      if (skip(victim)) continue;
      const distance = Math.abs(product - victimFreq);
      if (distance < guard) visit(victim, distance);
    }
  };

  // --- IM3, two transmitters: 2·fi − fj (ordered pairs cover both directions).
  for (let i = 0; i < n; i += 1) {
    const fi = freqs[i] as number;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const product = 2 * fi - (freqs[j] as number);
      forEachVictim(
        product,
        options.im3TwoTxKHz,
        (victim) => victim === i || victim === j || !sees(victim, i) || !sees(victim, j),
        (victim, distance) =>
          emit({
            kind: 'im3-2tx',
            sourceIndices: [i, j],
            coefficients: [2, -1],
            productKHz: product,
            victimIndex: victim,
            distanceKHz: distance,
            requiredKHz: options.im3TwoTxKHz,
          }),
      );
    }
  }

  // --- IM3, three transmitters: fi + fj − fk, {i,j} unordered, k distinct.
  if (options.enableIm3ThreeTx && n >= 3) {
    for (let i = 0; i < n; i += 1) {
      const fi = freqs[i] as number;
      for (let j = i + 1; j < n; j += 1) {
        const sum = fi + (freqs[j] as number);
        for (let k = 0; k < n; k += 1) {
          if (k === i || k === j) continue;
          const product = sum - (freqs[k] as number);
          forEachVictim(
            product,
            options.im3ThreeTxKHz,
            (victim) => {
              if (!sees(victim, i) || !sees(victim, j) || !sees(victim, k)) return true;
              // Additive generator as victim: residual |other additive − k|,
              // covered by spacing unless those two never constrain each other.
              if (victim === i) return relation(j, k) !== 'none';
              if (victim === j) return relation(i, k) !== 'none';
              // Subtractive generator as victim: the 2-transmitter form, which
              // only runs when the two additive generators see each other.
              if (victim === k) return relation(i, j) === 'full';
              return false;
            },
            (victim, distance) =>
              emit({
                kind: 'im3-3tx',
                sourceIndices: [i, j, k],
                coefficients: [1, 1, -1],
                productKHz: product,
                victimIndex: victim,
                distanceKHz: distance,
                requiredKHz: options.im3ThreeTxKHz,
              }),
          );
        }
      }
    }
  }

  // --- IM5, two transmitters: 3·fi − 2·fj.
  if (options.enableIm5TwoTx) {
    for (let i = 0; i < n; i += 1) {
      const fi = freqs[i] as number;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const product = 3 * fi - 2 * (freqs[j] as number);
        forEachVictim(
          product,
          options.im5TwoTxKHz,
          (victim) => victim === i || victim === j || !sees(victim, i) || !sees(victim, j),
          (victim, distance) =>
            emit({
              kind: 'im5-2tx',
              sourceIndices: [i, j],
              coefficients: [3, -2],
              productKHz: product,
              victimIndex: victim,
              distanceKHz: distance,
              requiredKHz: options.im5TwoTxKHz,
            }),
        );
      }
    }
  }
}
