import { describe, expect, it } from 'vitest';
import { checkPlan, distanceToInterval, requiredExclusionKHz, requiredSpacingKHz } from '../src/check.js';
import { ENGINE_VERSION } from '../src/version.js';
import { link, tntChannel } from './fixtures/links.js';
import type { EngineBand } from '../src/types.js';

const FR_BANDS: EngineBand[] = [
  { fromKHz: 470_000, toKHz: 694_000, status: 'free', label: 'UHF 470–694' },
  { fromKHz: 694_000, toKHz: 790_000, status: 'forbidden', label: 'Bande 700' },
  { fromKHz: 1_240_000, toKHz: 1_260_000, status: 'temporary', label: '1,2 GHz' },
];

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
    expect(checkPlan({ links: [link('A')], plan: [{ linkId: 'A', freqKHz: 700_000 }] }).ok).toBe(true);
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
