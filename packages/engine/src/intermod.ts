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
   * `participates[a][b]` — whether carrier `b` may act on carrier `a` through
   * intermodulation. Asymmetric by construction (zone policies differ per
   * zone), so it is read as "b is visible to a".
   */
  visible: (victim: number, source: number) => boolean;
}

/**
 * Reference test for the "already covered by the spacing rule" case.
 *
 * A product `P = Σ cᵢ·fᵢ` is compared against a victim `f_v`. When the victim
 * is one of the generators, the residual `P − f_v` has coefficients summing to
 * zero. If only two of them are non-zero the residual is `±m·(fᵢ − fⱼ)` — a
 * plain carrier-to-carrier distance, which the spacing rule already enforces
 * and more strictly. Reporting it as intermodulation would double-count.
 *
 * The hot loops below inline the specialised form of this predicate; a unit
 * test pins the two implementations together.
 */
export function isDegenerateResidual(
  sourceIndices: readonly number[],
  coefficients: readonly number[],
  victimIndex: number,
): boolean {
  const residual = new Map<number, number>();
  for (const [k, index] of sourceIndices.entries()) {
    residual.set(index, (residual.get(index) ?? 0) + (coefficients[k] as number));
  }
  residual.set(victimIndex, (residual.get(victimIndex) ?? 0) - 1);
  let nonZero = 0;
  for (const c of residual.values()) if (c !== 0) nonZero += 1;
  return nonZero <= 2;
}

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
        // Victim i gives residual (1,−1), victim j gives (2,−2): both degenerate.
        (victim) =>
          victim === i ||
          victim === j ||
          !options.visible(victim, i) ||
          !options.visible(victim, j),
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
            // Victim i or j gives residual (0,1,−1): degenerate. Victim k gives
            // (1,1,−2) — three non-zero terms, a genuine intermodulation case.
            (victim) =>
              victim === i ||
              victim === j ||
              !options.visible(victim, i) ||
              !options.visible(victim, j) ||
              !options.visible(victim, k),
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
          // Victim i gives (2,−2), victim j gives (3,−3): both degenerate.
          (victim) =>
            victim === i ||
            victim === j ||
            !options.visible(victim, i) ||
            !options.visible(victim, j),
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
