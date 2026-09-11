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

import type { Guards } from './types.js';
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
  /** Guard of the victim for this kind of product. */
  requiredKHz: number;
}

export interface ImOptions {
  /** Guards per carrier index. A product is measured against the victim's. */
  guards: readonly Guards[];
  /**
   * Hits are reported up to `windowFactor × guard` so that a plan can say how
   * much room it has; `distanceKHz < requiredKHz` tells a violation from a
   * margin reading.
   */
  windowFactor: number;
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
 * whose coefficients sum to zero:
 *
 *   2·f1 − f2    vs f1  →  |f1 − f2|         carrier spacing (f1, f2)
 *   2·f1 − f2    vs f2  →  2·|f1 − f2|       carrier spacing (f1, f2)
 *   3·f1 − 2·f2  vs f1  →  2·|f1 − f2|       carrier spacing (f1, f2)
 *   3·f1 − 2·f2  vs f2  →  3·|f1 − f2|       carrier spacing (f1, f2)
 *   f1 + f2 − f3 vs f1  →  |f2 − f3|         carrier spacing (f2, f3)
 *   f1 + f2 − f3 vs f3  →  |f1 + f2 − 2·f3|  the 2-transmitter product 2·f3 − f1
 *                                            measured against f2
 *
 * The 2-transmitter families are never reported against their own generators.
 * The product then sits at the distance of a neighbouring carrier that the
 * spacing rule already allows or forbids, and it is weaker than that carrier:
 * spacing decides, whatever its value. Shure's own HD profiles space carriers
 * closer than their IM3 guard, which is only consistent under this reading.
 *
 * The 3-transmitter cases involve a third carrier, so the covering rule is a
 * different rule with a different guard. They are skipped only when it
 * actually runs — spacing is skipped between `isolated` zones, and the
 * 2-transmitter form needs f2 to see f1 — **and** with a guard at least as
 * wide as the victim's own. Otherwise nothing else would report the product,
 * and it is reported here, under its own name.
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
 * Walks every intermodulation product of `freqs` that lands within the
 * victim's window, and reports it through `emit`.
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
  const { relation, guards, windowFactor } = options;
  const sees = (victim: number, source: number): boolean => relation(victim, source) === 'full';
  const guardOf = (victim: number, kind: ImKind): number => {
    const g = guards[victim] as Guards;
    return kind === 'im3-2tx' ? g.im3TwoTxKHz : kind === 'im3-3tx' ? g.im3ThreeTxKHz : g.im5TwoTxKHz;
  };
  // Widest window over all victims bounds the sorted search; each victim is
  // then held to its own.
  const widest = (kind: ImKind): number => {
    let max = 0;
    for (let i = 0; i < n; i += 1) max = Math.max(max, guardOf(i, kind));
    return max * windowFactor;
  };

  // Victims indexed by ascending frequency, so each product only has to look at
  // the handful of carriers inside the window.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (freqs[a] as number) - (freqs[b] as number) || a - b,
  );
  const sorted = new Float64Array(n);
  for (let k = 0; k < n; k += 1) sorted[k] = freqs[order[k] as number] as number;

  const forEachVictim = (
    product: number,
    kind: ImKind,
    searchWindow: number,
    skip: (victim: number) => boolean,
    visit: (victim: number, distance: number, required: number) => void,
  ): void => {
    let k = lowerBound(sorted, n, product - searchWindow);
    for (; k < n; k += 1) {
      const victimFreq = sorted[k] as number;
      if (victimFreq > product + searchWindow) break;
      const victim = order[k] as number;
      if (skip(victim)) continue;
      const required = guardOf(victim, kind);
      const distance = Math.abs(product - victimFreq);
      if (distance < required * windowFactor) visit(victim, distance, required);
    }
  };

  // --- IM3, two transmitters: 2·fi − fj (ordered pairs cover both directions).
  const window3a = widest('im3-2tx');
  for (let i = 0; i < n; i += 1) {
    const fi = freqs[i] as number;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const product = 2 * fi - (freqs[j] as number);
      forEachVictim(
        product,
        'im3-2tx',
        window3a,
        (victim) => victim === i || victim === j || !sees(victim, i) || !sees(victim, j),
        (victim, distance, required) =>
          emit({
            kind: 'im3-2tx',
            sourceIndices: [i, j],
            coefficients: [2, -1],
            productKHz: product,
            victimIndex: victim,
            distanceKHz: distance,
            requiredKHz: required,
          }),
      );
    }
  }

  // --- IM3, three transmitters: fi + fj − fk, {i,j} unordered, k distinct.
  if (options.enableIm3ThreeTx && n >= 3) {
    const window3b = widest('im3-3tx');
    for (let i = 0; i < n; i += 1) {
      const fi = freqs[i] as number;
      for (let j = i + 1; j < n; j += 1) {
        const sum = fi + (freqs[j] as number);
        for (let k = 0; k < n; k += 1) {
          if (k === i || k === j) continue;
          const product = sum - (freqs[k] as number);
          forEachVictim(
            product,
            'im3-3tx',
            window3b,
            (victim) => {
              if (!sees(victim, i) || !sees(victim, j) || !sees(victim, k)) return true;
              // A generator as its own victim (D-005): the residual is a quantity
              // another rule measures, and that rule decides — with its own
              // guard, whatever its value — whenever it runs at all.
              // Additive generator: residual |other additive − k|, the spacing
              // of that pair, skipped only between `isolated` zones.
              if (victim === i) return relation(j, k) !== 'none';
              if (victim === j) return relation(i, k) !== 'none';
              // Subtractive generator: residual |i + j − 2k|, the 2-transmitter
              // forms 2k − i against j and 2k − j against i, which run only
              // when i and j see each other.
              if (victim === k) return relation(i, j) === 'full';
              return false;
            },
            (victim, distance, required) =>
              emit({
                kind: 'im3-3tx',
                sourceIndices: [i, j, k],
                coefficients: [1, 1, -1],
                productKHz: product,
                victimIndex: victim,
                distanceKHz: distance,
                requiredKHz: required,
              }),
          );
        }
      }
    }
  }

  // --- IM5, two transmitters: 3·fi − 2·fj.
  if (options.enableIm5TwoTx) {
    const window5 = widest('im5-2tx');
    for (let i = 0; i < n; i += 1) {
      const fi = freqs[i] as number;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const product = 3 * fi - 2 * (freqs[j] as number);
        forEachVictim(
          product,
          'im5-2tx',
          window5,
          (victim) => victim === i || victim === j || !sees(victim, i) || !sees(victim, j),
          (victim, distance, required) =>
            emit({
              kind: 'im5-2tx',
              sourceIndices: [i, j],
              coefficients: [3, -2],
              productKHz: product,
              victimIndex: victim,
              distanceKHz: distance,
              requiredKHz: required,
            }),
        );
      }
    }
  }
}
