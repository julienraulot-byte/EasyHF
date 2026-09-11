import { describe, expect, it } from 'vitest';
import { checkPlan, distanceToInterval, requiredExclusionKHz, requiredSpacingKHz } from '../src/check.js';
import { ENGINE_VERSION } from '../src/version.js';
import { FR_BANDS, link, tntChannel } from './fixtures/links.js';
import type { Guards } from '../src/types.js';

describe('helpers', () => {
  it('widens the carrier spacing by the two channel widths, and takes the larger spacing', () => {
    const wide = link('A', { channelWidthKHz: 800 });
    expect(requiredSpacingKHz(link('A'), link('B'), 300, 300)).toBe(300);
    expect(requiredSpacingKHz(wide, wide, 300, 300)).toBe(800);
    expect(requiredSpacingKHz(link('A'), link('B'), 300, 350)).toBe(350);
  });

  it('widens the exclusion guard by the carrier half-width', () => {
    expect(requiredExclusionKHz(link('A'), 250)).toBe(250);
    expect(requiredExclusionKHz(link('A', { channelWidthKHz: 1_000 }), 250)).toBe(500);
  });

  it('measures the distance to a closed interval', () => {
    expect(distanceToInterval(100, 200, 300)).toBe(100);
    expect(distanceToInterval(400, 200, 300)).toBe(100);
    expect(distanceToInterval(250, 200, 300)).toBe(0);
  });
});

describe('checkPlan — carrier spacing', () => {
  it('reports carriers closer than the guard', () => {
    const result = checkPlan({
      links: [link('A'), link('B')],
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 500_250 },
      ],
    });
    const spacing = result.violations.filter((v) => v.kind === 'spacing');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]?.actualKHz).toBe(250);
    expect(spacing[0]?.requiredKHz).toBe(300);
    expect(result.ok).toBe(false);
  });

  it('accepts carriers exactly on the guard', () => {
    const result = checkPlan({
      links: [link('A'), link('B')],
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 500_300 },
      ],
    });
    expect(result.violations.filter((v) => v.kind === 'spacing')).toHaveLength(0);
    expect(result.margins.spacingKHz).toBe(300);
  });
});

describe('checkPlan — exclusions', () => {
  it('reports a carrier inside a TNT channel', () => {
    const result = checkPlan({
      links: [link('A')],
      plan: [{ linkId: 'A', freqKHz: 546_000 }],
      exclusions: [tntChannel(30)], // 542–550 MHz
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.kind).toBe('exclusion');
    expect(result.violations[0]?.actualKHz).toBe(0);
    expect(result.violations[0]?.message).toContain('Canal TNT 30');
  });

  it('reports a carrier inside the guard band of an exclusion', () => {
    const result = checkPlan({
      links: [link('A')],
      plan: [{ linkId: 'A', freqKHz: 550_200 }],
      exclusions: [tntChannel(30)],
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['exclusion']);
    expect(result.violations[0]?.actualKHz).toBe(200);
  });

  it('accepts a carrier exactly at the guard distance', () => {
    const result = checkPlan({
      links: [link('A')],
      plan: [{ linkId: 'A', freqKHz: 550_250 }],
      exclusions: [tntChannel(30)],
    });
    expect(result.ok).toBe(true);
    expect(result.margins.exclusionKHz).toBe(250);
  });
});

describe('checkPlan — regulatory bands', () => {
  it('rejects a carrier in the forbidden 700 MHz band', () => {
    const result = checkPlan({
      links: [link('A', { tuningRangeKHz: [470_000, 790_000] })],
      plan: [{ linkId: 'A', freqKHz: 700_000 }],
      bands: FR_BANDS,
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['out-of-band']);
  });

  it('rejects a carrier whose channel straddles a band edge', () => {
    const result = checkPlan({
      links: [link('A', { tuningRangeKHz: [470_000, 790_000] })],
      plan: [{ linkId: 'A', freqKHz: 693_950 }],
      bands: FR_BANDS,
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['out-of-band']);
  });

  it('treats two contiguous allowed bands as one', () => {
    // A plan may split a physical band into two entries carrying different
    // notes; a carrier on the seam is not out of band.
    const split = [
      { fromKHz: 470_000, toKHz: 600_000, status: 'free' as const },
      { fromKHz: 600_000, toKHz: 694_000, status: 'free' as const },
    ];
    const result = checkPlan({ links: [link('A')], plan: [{ linkId: 'A', freqKHz: 599_950 }], bands: split });
    expect(result.ok).toBe(true);
    // But a forbidden neighbour still bites.
    const bounded = [
      { fromKHz: 470_000, toKHz: 600_000, status: 'free' as const },
      { fromKHz: 600_000, toKHz: 694_000, status: 'forbidden' as const },
    ];
    expect(checkPlan({ links: [link('A')], plan: [{ linkId: 'A', freqKHz: 599_950 }], bands: bounded }).ok).toBe(false);
  });

  it('honours allowTemporaryBands', () => {
    const input = {
      links: [link('A', { tuningRangeKHz: [1_240_000, 1_260_000] })],
      plan: [{ linkId: 'A', freqKHz: 1_250_000 }],
      bands: FR_BANDS,
    };
    expect(checkPlan(input).ok).toBe(true);
    expect(checkPlan({ ...input, config: { allowTemporaryBands: false } }).ok).toBe(false);
  });

  it('skips the band check entirely when no band plan is supplied', () => {
    const links = [link('A', { tuningRangeKHz: [470_000, 790_000] })];
    expect(checkPlan({ links, plan: [{ linkId: 'A', freqKHz: 700_000 }] }).ok).toBe(true);
  });
});

describe('checkPlan — zones', () => {
  const links = [link('A', { zoneId: 'scene1' }), link('B', { zoneId: 'scene2' })];
  const plan = [
    { linkId: 'A', freqKHz: 500_000 },
    { linkId: 'B', freqKHz: 500_100 },
  ];

  it('keeps spacing but not intermodulation between undeclared zones', () => {
    // The default is what Wireless Workbench does between RF zones (D-010).
    expect(checkPlan({ links, plan }).violations.map((v) => v.kind)).toEqual(['spacing']);

    const trio = [link('A', { zoneId: 'x' }), link('B', { zoneId: 'x' }), link('C', { zoneId: 'y' })];
    const onProduct = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 506_000 },
      { linkId: 'C', freqKHz: 494_000 }, // 2·A − B, in the other zone
    ];
    expect(checkPlan({ links: trio, plan: onProduct }).violations).toHaveLength(0);
    expect(
      checkPlan({ links: trio, plan: onProduct, zonePolicies: { x: 'full-intermod', y: 'full-intermod' } })
        .violations.map((v) => v.kind),
    ).toEqual(['im3-2tx', 'im3-2tx']);
  });

  it('drops every constraint between isolated zones', () => {
    const result = checkPlan({
      links,
      plan,
      zonePolicies: { scene1: 'isolated', scene2: 'isolated' },
    });
    expect(result.violations).toHaveLength(0);
  });

  it('keeps spacing but not intermodulation under spacing-only', () => {
    const trio = [
      link('A', { zoneId: 'scene1' }),
      link('B', { zoneId: 'scene1' }),
      link('C', { zoneId: 'scene2' }),
    ];
    const result = checkPlan({
      links: trio,
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 506_000 },
        { linkId: 'C', freqKHz: 494_000 }, // 2·A − B
      ],
      zonePolicies: { scene1: 'spacing-only', scene2: 'spacing-only' },
    });
    expect(result.violations).toHaveLength(0);
  });

  it('takes the more constraining of two disagreeing policies', () => {
    const result = checkPlan({
      links,
      plan,
      zonePolicies: { scene1: 'isolated', scene2: 'full-intermod' },
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['spacing']);
  });
});

describe('checkPlan — hardware limits', () => {
  it('rejects a frequency outside the tuning range of its own hardware', () => {
    // Reached through manual entry and plan imports: a receiver that cannot be
    // tuned there makes the rest of the analysis beside the point.
    const result = checkPlan({
      links: [link('A', { tuningRangeKHz: [534_000, 598_000] })],
      plan: [{ linkId: 'A', freqKHz: 650_000 }],
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['out-of-tuning-range']);
    expect(result.violations[0]?.message).toMatch(/hors de la plage/);
  });

  it('rejects a frequency off the hardware tuning grid', () => {
    const result = checkPlan({
      links: [link('A', { tuningRangeKHz: [534_000, 598_000], stepKHz: 25 })],
      plan: [{ linkId: 'A', freqKHz: 550_013 }],
    });
    expect(result.violations.map((v) => v.kind)).toEqual(['out-of-tuning-range']);
    expect(result.violations[0]?.message).toMatch(/grille d'accord/);
  });

  it('accepts the exact bounds of the tuning range', () => {
    const links = [link('A', { tuningRangeKHz: [534_000, 598_000] })];
    for (const freqKHz of [534_000, 598_000]) {
      expect(checkPlan({ links, plan: [{ linkId: 'A', freqKHz }] }).ok).toBe(true);
    }
  });
});

describe('checkPlan — a product hitting its own generator across zones', () => {
  // These are detection tests, not consistency tests: they pin what the checker
  // must find on its own, regardless of what the assignment search believes.
  it('reports the equidistant triplet when the middle carrier alone sees both others', () => {
    // A, B, C at 400 kHz steps: A + C − B lands exactly on B. Within one zone
    // the 2-transmitter forms 2B − A and 2B − C report it. Here A and C never
    // see each other, so those forms are silent — and the 3-transmitter one
    // must speak.
    const links = [link('A', { zoneId: 'a' }), link('B', { zoneId: 'b' }), link('C', { zoneId: 'c' })];
    const plan = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 500_400 },
      { linkId: 'C', freqKHz: 500_800 },
    ];
    for (const outer of ['spacing-only', 'isolated'] as const) {
      const result = checkPlan({ links, plan, zonePolicies: { a: outer, b: 'full-intermod', c: outer } });
      expect(result.ok, outer).toBe(false);
      expect(result.violations.map((v) => v.kind)).toEqual(['im3-3tx']);
      expect(result.violations[0]?.victimLinkId).toBe('B');
      expect(result.violations[0]?.actualKHz).toBe(0);
    }
  });

  it('reports two near-co-channel carriers beating in a receiver that sees both', () => {
    // B and C are 50 kHz apart in zones isolated from each other, so no spacing
    // rule runs between them. A sees both: A + B − C lands 50 kHz from A.
    const result = checkPlan({
      links: [link('A', { zoneId: 'a' }), link('B', { zoneId: 'b' }), link('C', { zoneId: 'c' })],
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 510_000 },
        { linkId: 'C', freqKHz: 510_050 },
      ],
      zonePolicies: { a: 'full-intermod', b: 'isolated', c: 'isolated' },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.every((v) => v.kind === 'im3-3tx' && v.victimLinkId === 'A')).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('stays quiet within one zone, where the covering rules run', () => {
    const links = [link('A'), link('B'), link('C')];
    const triplet = checkPlan({
      links,
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 500_400 },
        { linkId: 'C', freqKHz: 500_800 },
      ],
    });
    expect(triplet.violations.map((v) => v.kind)).toEqual(['im3-2tx', 'im3-2tx']);
  });
});

describe('checkPlan — per-model guards (D-023)', () => {
  const loose = { im3TwoTxKHz: 75, im3ThreeTxKHz: 0, im5TwoTxKHz: 0, spacingKHz: 350 };

  it('holds a product to the guard of the carrier it hits, not of its generators', () => {
    // 2 × 500 000 − 506 000 = 494 000. The victim sits 150 kHz away.
    const links = [
      link('A', { guards: loose }),
      link('B', { guards: loose }),
      link('C', { guards: { im3TwoTxKHz: 200 } }),
    ];
    const plan = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 506_000 },
      { linkId: 'C', freqKHz: 494_150 },
    ];
    const hit = checkPlan({ links, plan });
    expect(hit.violations.map((v) => [v.kind, v.victimLinkId, v.requiredKHz])).toEqual([['im3-2tx', 'C', 200]]);

    // Same geometry, the loose receiver as the victim: 150 kHz clears 75.
    const swapped = checkPlan({
      links: [link('A', { guards: loose }), link('B', { guards: { im3TwoTxKHz: 200 } }), link('C', { guards: { im3TwoTxKHz: 200 } })],
      plan: [
        { linkId: 'A', freqKHz: 494_150 },
        { linkId: 'B', freqKHz: 506_000 },
        { linkId: 'C', freqKHz: 500_000 },
      ],
    });
    expect(swapped.violations.filter((v) => v.victimLinkId === 'A')).toEqual([]);
  });

  it('spaces a pair by the larger of the two spacings', () => {
    const result = checkPlan({
      links: [link('A', { guards: { spacingKHz: 350 } }), link('B')],
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 500_325 },
      ],
    });
    expect(result.violations.map((v) => [v.kind, v.requiredKHz])).toEqual([['spacing', 350]]);
  });

  it('keeps each carrier clear of exclusions by its own guard', () => {
    const links = [link('A', { guards: { exclusionKHz: 500 } }), link('B')];
    const exclusions = [tntChannel(30)]; // 542–550 MHz
    const plan = [
      { linkId: 'A', freqKHz: 550_400 },
      { linkId: 'B', freqKHz: 550_800 },
    ];
    expect(checkPlan({ links, plan, exclusions }).violations.map((v) => v.victimLinkId)).toEqual(['A']);
  });

  it('reports a 3-transmitter hit that the 2-transmitter form no longer covers', () => {
    // A + B − 2C = 100 kHz. With uniform guards the 2-transmitter form
    // (2C − A against B, guard 200) reports it. Here A and B only carry a
    // 75 kHz 2-transmitter guard: 100 kHz clears it, and only C's own
    // 3-transmitter guard of 150 can see the product.
    const links = [
      link('A', { guards: { im3TwoTxKHz: 75, im3ThreeTxKHz: 75 } }),
      link('B', { guards: { im3TwoTxKHz: 75, im3ThreeTxKHz: 75 } }),
      link('C', { guards: { im3ThreeTxKHz: 150 } }),
    ];
    const plan = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 505_000 },
      { linkId: 'C', freqKHz: 502_450 },
    ];
    const result = checkPlan({ links, plan });
    expect(result.violations.map((v) => [v.kind, v.victimLinkId, v.actualKHz])).toEqual([['im3-3tx', 'C', 100]]);
  });

  it('reports two near-co-channel carriers beating in a receiver whose guard exceeds their spacing', () => {
    // B and C are 100 kHz apart, which their own tiny spacing allows. A's
    // 3-transmitter guard is 150: A + B − C lands 100 kHz from A.
    const tiny = { im3TwoTxKHz: 50, im3ThreeTxKHz: 50, im5TwoTxKHz: 40, spacingKHz: 60 };
    const links = [
      link('A', { guards: { im3ThreeTxKHz: 150 } }),
      link('B', { guards: tiny, channelWidthKHz: 25 }),
      link('C', { guards: tiny, channelWidthKHz: 25 }),
    ];
    const plan = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 510_000 },
      { linkId: 'C', freqKHz: 510_100 },
    ];
    const result = checkPlan({ links, plan });
    expect(result.violations.map((v) => v.kind)).toEqual(['im3-3tx', 'im3-3tx']);
    expect(result.violations.every((v) => v.victimLinkId === 'A')).toBe(true);
  });

  it('names the link when its override is malformed', () => {
    expect(() =>
      checkPlan({ links: [link('A', { guards: { spacingKHz: -5 } })], plan: [] }),
    ).toThrow(/Liaison « A »/);
  });
});

describe('checkPlan — malformed input', () => {
  it('rejects an inverted exclusion rather than reading it two ways', () => {
    expect(() =>
      checkPlan({
        links: [link('A')],
        plan: [],
        exclusions: [{ fromKHz: 550_000, toKHz: 540_000, source: 'manual', label: 'inversée' }],
      }),
    ).toThrow(/inversée/);
  });
});

describe('checkPlan — reporting', () => {
  it('marks IM3 critical and IM5 a warning', () => {
    const result = checkPlan({
      links: [link('A'), link('B'), link('C')],
      plan: [
        { linkId: 'A', freqKHz: 500_000 },
        { linkId: 'B', freqKHz: 500_300 },
        { linkId: 'C', freqKHz: 499_400 }, // 3·A − 2·B, far from any IM3 product
      ],
    });
    const im5 = result.violations.filter((v) => v.kind === 'im5-2tx');
    expect(im5.length).toBeGreaterThan(0);
    expect(im5.every((v) => v.severity === 'warning')).toBe(true);
    expect(result.ok).toBe(true); // warnings alone do not sink a plan
  });

  it('orders violations independently of the order links are given in', () => {
    const links = [link('A'), link('B'), link('C')];
    const plan = [
      { linkId: 'A', freqKHz: 500_000 },
      { linkId: 'B', freqKHz: 500_400 },
      { linkId: 'C', freqKHz: 499_600 },
    ];
    const forward = checkPlan({ links, plan });
    const backward = checkPlan({ links: [...links].reverse(), plan: [...plan].reverse() });
    expect(backward).toEqual(forward);
  });

  it('separates two exclusions that cover a carrier identically', () => {
    // Same bounds, same nearest edge, no source links: only the label tells the
    // two violations apart, and the report must still be order-independent.
    const overlapping = [
      { fromKHz: 540_000, toKHz: 550_000, source: 'scan' as const, label: 'Scan TinySA' },
      { fromKHz: 540_000, toKHz: 550_000, source: 'tnt-anfr' as const, label: 'Canal TNT 30' },
    ];
    const forward = checkPlan({
      links: [link('A')],
      plan: [{ linkId: 'A', freqKHz: 545_000 }],
      exclusions: overlapping,
    });
    const backward = checkPlan({
      links: [link('A')],
      plan: [{ linkId: 'A', freqKHz: 545_000 }],
      exclusions: [...overlapping].reverse(),
    });
    expect(forward.violations).toHaveLength(2);
    expect(backward.violations).toEqual(forward.violations);
    expect(forward.violations.map((v) => v.message)).toEqual([
      ...forward.violations.map((v) => v.message),
    ].sort());
  });

  it('stamps the engine version', () => {
    expect(checkPlan({ links: [link('A')], plan: [] }).engineVersion).toBe(ENGINE_VERSION);
  });

  it('rejects malformed input loudly', () => {
    expect(() => checkPlan({ links: [link('A'), link('A')], plan: [] })).toThrow(/en double/);
    expect(() => checkPlan({ links: [link('A')], plan: [{ linkId: 'Z', freqKHz: 1 }] })).toThrow(/inconnue/);
    expect(() =>
      checkPlan({
        links: [link('A')],
        plan: [
          { linkId: 'A', freqKHz: 1 },
          { linkId: 'A', freqKHz: 2 },
        ],
      }),
    ).toThrow(/deux fois/);
  });
});

describe('resolveConfig — gardes', () => {
  const withGuards = (guards: Partial<Guards>) =>
    checkPlan({ links: [link('A')], plan: [], config: { guards } });

  it('accepte un espacement inférieur à la garde IM3, comme les profils HD de Shure', () => {
    expect(() => withGuards({ spacingKHz: 125, im3TwoTxKHz: 200, im3ThreeTxKHz: 150 })).not.toThrow();
  });

  it('refuse une garde négative ou non entière', () => {
    expect(() => withGuards({ im5TwoTxKHz: -1 })).toThrow(/invalide/);
    expect(() => withGuards({ im5TwoTxKHz: 12.5 })).toThrow(/invalide/);
  });
});
