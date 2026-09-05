import { describe, expect, it } from 'vitest';
import { checkPlan, distanceToInterval, requiredExclusionKHz, requiredSpacingKHz } from '../src/check.js';
import { ENGINE_VERSION } from '../src/version.js';
import { FR_BANDS, link, tntChannel } from './fixtures/links.js';
import type { Guards } from '../src/types.js';

describe('helpers', () => {
  it('widens the carrier spacing by the two channel widths', () => {
    const wide = link('A', { channelWidthKHz: 800 });
    expect(requiredSpacingKHz(link('A'), link('B'), 300)).toBe(300);
    expect(requiredSpacingKHz(wide, wide, 300)).toBe(800);
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

  it('constrains zones fully by default', () => {
    expect(checkPlan({ links, plan }).violations.map((v) => v.kind)).toEqual(['spacing']);
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

describe('resolveConfig — cohérence des gardes', () => {
  const withGuards = (guards: Partial<Guards>) =>
    checkPlan({ links: [link('A')], plan: [], config: { guards } });

  it('refuse une garde IM3 3 émetteurs plus large que celle à 2 émetteurs', () => {
    expect(() => withGuards({ im3ThreeTxKHz: 300 })).toThrow(/3 émetteurs/);
  });

  it('refuse un espacement inférieur à la garde IM3', () => {
    // Sans cette règle, 2·f1 − f2 à 150 kHz de f1 ne serait signalé nulle part.
    expect(() => withGuards({ spacingKHz: 100 })).toThrow(/espacement co-canal/i);
  });

  it('refuse un espacement inférieur à la moitié de la garde IM5', () => {
    expect(() => withGuards({ im3TwoTxKHz: 40, im3ThreeTxKHz: 40, spacingKHz: 40, im5TwoTxKHz: 90 })).toThrow(
      /moitié/,
    );
  });

  it('refuse une garde négative ou non entière', () => {
    expect(() => withGuards({ im5TwoTxKHz: -1 })).toThrow(/invalide/);
    expect(() => withGuards({ im5TwoTxKHz: 12.5 })).toThrow(/invalide/);
  });
});
