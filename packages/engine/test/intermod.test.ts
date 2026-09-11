import { describe, expect, it } from 'vitest';
import { forEachImHit, type ImHit, type ImOptions } from '../src/intermod.js';
import type { Guards } from '../src/types.js';

const oneZone: ImOptions['relation'] = () => 'full';

const UNIFORM: Guards = { im3TwoTxKHz: 200, im3ThreeTxKHz: 200, im5TwoTxKHz: 90, spacingKHz: 300, exclusionKHz: 250 };

interface CollectOptions extends Partial<Omit<ImOptions, 'guards'>> {
  guards?: Partial<Guards>;
}

/** Every carrier held to the same guards, one zone, no margin window. */
function collect(freqs: number[], options: CollectOptions = {}): ImHit[] {
  const hits: ImHit[] = [];
  const { guards, ...rest } = options;
  const each: Guards = { ...UNIFORM, ...guards };
  forEachImHit(
    freqs,
    {
      guards: freqs.map(() => each),
      windowFactor: 1,
      enableIm3ThreeTx: true,
      enableIm5TwoTx: true,
      relation: oneZone,
      spacingRequired: () => each.spacingKHz,
      ...rest,
    },
    (hit) => hits.push(hit),
  );
  return hits;
}

describe('forEachImHit — 3rd order, 2 transmitters', () => {
  it('flags a carrier sitting exactly on 2·f1 − f2', () => {
    // 2 × 500 000 − 500 400 = 499 600
    const hits = collect([500_000, 500_400, 499_600], { enableIm3ThreeTx: false, enableIm5TwoTx: false });
    const hit = hits.find((h) => h.victimIndex === 2 && h.kind === 'im3-2tx');
    expect(hit).toBeDefined();
    expect(hit?.productKHz).toBe(499_600);
    expect(hit?.distanceKHz).toBe(0);
    expect(hit?.sourceIndices).toEqual([0, 1]);
  });

  it('flags 2·f2 − f1 as well as 2·f1 − f2', () => {
    // 2 × 500 400 − 500 000 = 500 800
    const hits = collect([500_000, 500_400, 500_800], { enableIm3ThreeTx: false, enableIm5TwoTx: false });
    expect(hits.some((h) => h.victimIndex === 2 && h.sourceIndices[0] === 1)).toBe(true);
  });

  it('applies the guard as a strict inequality', () => {
    // Product 2 × 500 000 − 500 400 = 499 600; a victim 199 kHz away is caught,
    // 200 kHz away is not. The relation 2·f1 = f2 + v is symmetric in f2 and v,
    // so a near miss is always reported twice — once from each of the two roles.
    const near = collect([500_000, 500_400, 499_401], { enableIm3ThreeTx: false, enableIm5TwoTx: false });
    expect(near).toHaveLength(2);
    expect(new Set(near.map((h) => h.victimIndex))).toEqual(new Set([1, 2]));
    expect(collect([500_000, 500_400, 499_400], { enableIm3ThreeTx: false, enableIm5TwoTx: false })).toHaveLength(0);
  });

  it('does not report the generators themselves as victims', () => {
    // 2f1 − f2 vs f1 is |f1 − f2|: carrier spacing, not intermodulation.
    const hits = collect([500_000, 500_100], { enableIm3ThreeTx: false, enableIm5TwoTx: false });
    expect(hits).toHaveLength(0);
  });
});

describe('forEachImHit — 3rd order, 3 transmitters', () => {
  // A, B, C, D chosen so that A + D = B + C (the only relation between them),
  // and so that no 2-transmitter product lands near any of the four.
  const quad = [500_000, 505_300, 508_400, 513_700];

  it('flags a carrier on f1 + f2 − f3', () => {
    const hits = collect(quad, { enableIm5TwoTx: false });
    expect(hits.filter((h) => h.kind === 'im3-2tx')).toHaveLength(0);
    // A + D = B + C admits four victims: take either additive pair, subtract one
    // of the other two carriers, and the remaining one is hit.
    const threeTx = hits.filter((h) => h.kind === 'im3-3tx');
    expect(threeTx).toHaveLength(4);
    expect(threeTx.every((h) => h.distanceKHz === 0)).toBe(true);
    expect(new Set(threeTx.map((h) => h.victimIndex))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('is skipped when disabled', () => {
    expect(collect(quad, { enableIm3ThreeTx: false, enableIm5TwoTx: false })).toHaveLength(0);
  });
});

describe('forEachImHit — 5th order, 2 transmitters', () => {
  it('flags a carrier on 3·f1 − 2·f2 within the tighter IM5 guard', () => {
    // 3 × 500 000 − 2 × 500 300 = 499 400
    const hits = collect([500_000, 500_300, 499_400], { enableIm3ThreeTx: false });
    const im5 = hits.filter((h) => h.kind === 'im5-2tx' && h.victimIndex === 2);
    expect(im5).toHaveLength(1);
    expect(im5[0]?.requiredKHz).toBe(90);
  });

  it('uses the IM5 guard, not the IM3 guard', () => {
    // 100 kHz away: inside the 200 kHz IM3 guard but outside the 90 kHz IM5 one.
    const hits = collect([500_000, 500_300, 499_500], { enableIm3ThreeTx: false });
    expect(hits.filter((h) => h.kind === 'im5-2tx')).toHaveLength(0);
  });
});

describe('visibility', () => {
  it('drops products whose generators are invisible to the victim', () => {
    const hits = collect([500_000, 500_400, 499_600], {
      enableIm3ThreeTx: false,
      enableIm5TwoTx: false,
      relation: (a, b) => (a === 1 || b === 1 ? 'none' : 'full'),
    });
    expect(hits).toHaveLength(0);
  });
});

describe('a product hitting its own generator, within one zone', () => {
  it('leaves the carrier-spacing cases to the spacing rule', () => {
    // 2·f1 − f2 against f1 is |f1 − f2|; against f2 it is 2·|f1 − f2|. Same for
    // the 5th-order forms. None of them is intermodulation.
    expect(collect([500_000, 500_100])).toHaveLength(0);
    expect(collect([500_000, 500_030], { guards: { im3TwoTxKHz: 1_000, im5TwoTxKHz: 1_000, spacingKHz: 1_000 } })).toHaveLength(0);
  });

  it('reports f1 + f2 − 2·f3 as the 2-transmitter product it actually is', () => {
    // 500 000 + 502 000 − 2 × 501 000 = 0: the 3-transmitter form would hit f3.
    // It is the same quantity as 2 × 501 000 − 500 000 = 502 000 landing on f2,
    // which the 2-transmitter family reports — once, with the wider guard.
    const hits = collect([500_000, 502_000, 501_000], { enableIm5TwoTx: false });
    expect(hits.filter((h) => h.kind === 'im3-3tx')).toHaveLength(0);
    const twoTx = hits.filter((h) => h.kind === 'im3-2tx');
    expect(twoTx).toHaveLength(2);
    expect(twoTx.map((h) => h.distanceKHz)).toEqual([0, 0]);
    expect(new Set(twoTx.map((h) => h.victimIndex))).toEqual(new Set([0, 1]));
  });
});

describe('degenerate inputs', () => {
  it('returns nothing for fewer than two carriers', () => {
    expect(collect([])).toHaveLength(0);
    expect(collect([500_000])).toHaveLength(0);
  });
});
