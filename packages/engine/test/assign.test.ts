import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import { scaleGuards } from '../src/config.js';
import { festival, FR_BANDS, link, tntChannel } from './fixtures/links.js';
import type { EngineLink } from '../src/types.js';

describe('coordinate — basic guarantees', () => {
  it('produces a plan free of critical violations', () => {
    const links = festival();
    const result = coordinate({ links, bands: FR_BANDS });
    expect(result.unassignedLinkIds).toEqual([]);
    expect(result.assignments).toHaveLength(links.length);
    expect(result.violations.filter((v) => v.severity === 'critical')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.robustness.level).toBe(0);
  });

  it('agrees with checkPlan run independently on its own output', () => {
    const links = festival();
    const result = coordinate({ links, bands: FR_BANDS });
    const verified = checkPlan({
      links,
      plan: result.assignments,
      bands: FR_BANDS,
      config: { guards: result.robustness.guards },
    });
    expect(verified.violations).toEqual(result.violations);
    expect(verified.ok).toBe(true);
  });

  it('keeps every carrier on its hardware tuning grid and inside its range', () => {
    const links = festival();
    const byId = new Map(links.map((l) => [l.id, l]));
    for (const { linkId, freqKHz } of coordinate({ links, bands: FR_BANDS }).assignments) {
      const l = byId.get(linkId) as EngineLink;
      expect(freqKHz).toBeGreaterThanOrEqual(l.tuningRangeKHz[0]);
      expect(freqKHz).toBeLessThanOrEqual(l.tuningRangeKHz[1]);
      expect((freqKHz - l.tuningRangeKHz[0]) % l.stepKHz).toBe(0);
    }
  });
});

describe('coordinate — locked frequencies', () => {
  it('never moves a locked link and plans around it', () => {
    const links = [
      link('LOCK', { lockedFreqKHz: 550_000 }),
      ...Array.from({ length: 8 }, (_, i) => link(`HF${i + 1}`)),
    ];
    const result = coordinate({ links, bands: FR_BANDS });
    expect(result.assignments.find((a) => a.linkId === 'LOCK')?.freqKHz).toBe(550_000);
    expect(result.ok).toBe(true);
  });

  it('reports conflicts between locked links rather than hiding them', () => {
    const result = coordinate({
      links: [
        link('L1', { lockedFreqKHz: 550_000 }),
        link('L2', { lockedFreqKHz: 550_100 }),
      ],
      bands: FR_BANDS,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.kind)).toContain('spacing');
  });
});

describe('coordinate — exclusions and bands', () => {
  it('stays clear of TNT channels', () => {
    const exclusions = [28, 29, 30, 31, 32, 33].map(tntChannel); // 526–574 MHz
    const links = Array.from({ length: 10 }, (_, i) =>
      link(`HF${i + 1}`, { tuningRangeKHz: [510_000, 590_000] }),
    );
    const result = coordinate({ links, exclusions, bands: FR_BANDS });
    expect(result.ok).toBe(true);
    for (const { freqKHz } of result.assignments) {
      expect(freqKHz < 525_750 || freqKHz > 574_250).toBe(true);
    }
  });

  it('never assigns inside a forbidden band', () => {
    const links = Array.from({ length: 6 }, (_, i) =>
      link(`HF${i + 1}`, { tuningRangeKHz: [680_000, 750_000] }),
    );
    const result = coordinate({ links, bands: FR_BANDS });
    for (const { freqKHz } of result.assignments) expect(freqKHz).toBeLessThan(694_000);
  });
});

describe('coordinate — zone policies', () => {
  it('reuses the same spectrum in isolated zones', () => {
    const links = [
      ...Array.from({ length: 6 }, (_, i) => link(`A${i}`, { zoneId: 'a', tuningRangeKHz: [500_000, 510_000] })),
      ...Array.from({ length: 6 }, (_, i) => link(`B${i}`, { zoneId: 'b', tuningRangeKHz: [500_000, 510_000] })),
    ];
    const isolated = coordinate({
      links,
      zonePolicies: { a: 'isolated', b: 'isolated' },
    });
    expect(isolated.ok).toBe(true);
    const zoneA = isolated.assignments.filter((a) => a.linkId.startsWith('A')).map((a) => a.freqKHz);
    const zoneB = isolated.assignments.filter((a) => a.linkId.startsWith('B')).map((a) => a.freqKHz);
    expect(new Set(zoneA)).toEqual(new Set(zoneB));
  });

  it('needs more spectrum when the same zones are fully coupled', () => {
    const links = [
      ...Array.from({ length: 6 }, (_, i) => link(`A${i}`, { zoneId: 'a', tuningRangeKHz: [500_000, 510_000] })),
      ...Array.from({ length: 6 }, (_, i) => link(`B${i}`, { zoneId: 'b', tuningRangeKHz: [500_000, 510_000] })),
    ];
    const coupled = coordinate({ links, zonePolicies: { a: 'full-intermod', b: 'full-intermod' } });
    expect(new Set(coupled.assignments.map((a) => a.freqKHz)).size).toBe(12);
  });
});

describe('coordinate — fifth order stays a warning', () => {
  it('accepts a 5th-order hit rather than spending a rung of the ladder on it', () => {
    // 3 × 500 000 − 2 × 500 300 = 499 400. C can only sit 75 kHz away from it,
    // inside the 90 kHz IM5 guard but clear of every critical constraint.
    const result = coordinate({
      links: [
        link('A', { lockedFreqKHz: 500_000 }),
        link('B', { lockedFreqKHz: 500_300 }),
        link('C', { tuningRangeKHz: [499_475, 499_475] }),
      ],
      bands: FR_BANDS,
    });
    expect(result.assignments).toHaveLength(3);
    expect(result.robustness.level).toBe(0);
    expect(result.robustness.guards.spacingKHz).toBe(300);
    expect(result.violations.map((v) => [v.kind, v.severity])).toEqual([['im5-2tx', 'warning']]);
    expect(result.ok).toBe(true);
  });

  it('does not reach a worse rung than the same search with 5th order off, at equal placements', () => {
    // The second pass at each rung is, by construction, the search one gets
    // with IM5 disabled: same masks, same order. So enabling IM5 can add
    // warnings but cannot cost a rung — unless the first pass placed *more*
    // links, which the engine prefers over a lower rung (see D-016). This
    // load is tight enough to need the ladder and lands on equal placements.
    const links = Array.from({ length: 14 }, (_, i) =>
      link(`HF${String(i + 1).padStart(2, '0')}`, {
        zoneId: ['a', 'b', 'c'][i % 3] as string,
        tuningRangeKHz: [520_000, 532_000],
      }),
    );
    const zonePolicies = { a: 'full-intermod', b: 'spacing-only', c: 'spacing-only' } as const;
    const withIm5 = coordinate({ links, zonePolicies });
    const without = coordinate({ links, zonePolicies, config: { enableIm5TwoTx: false } });
    expect(withIm5.robustness.level).toBeLessThanOrEqual(without.robustness.level);
    expect(withIm5.unassignedLinkIds.length).toBeLessThanOrEqual(without.unassignedLinkIds.length);
  });

  it('prefers a 5th-order-clean frequency when one exists', () => {
    const clean = coordinate({
      links: [
        link('A', { lockedFreqKHz: 500_000 }),
        link('B', { lockedFreqKHz: 500_300 }),
        link('C', { tuningRangeKHz: [499_400, 499_600] }),
      ],
      bands: FR_BANDS,
    });
    expect(clean.violations).toEqual([]);
    expect(clean.assignments.find((a) => a.linkId === 'C')?.freqKHz).not.toBe(499_400);
  });
});

describe('coordinate — robustness ladder', () => {
  it('stays at the nominal guards when the spectrum is comfortable', () => {
    const result = coordinate({ links: festival(), bands: FR_BANDS });
    expect(result.robustness.level).toBe(0);
    expect(result.robustness.factor).toBe(1);
    expect(result.stats.ladderLevelsTried).toBe(1);
  });

  it('relaxes the guards, and says so, when the spectrum is too tight', () => {
    // Eight links squeezed into 2 MHz: impossible at a 300 kHz co-channel guard.
    const links = Array.from({ length: 8 }, (_, i) =>
      link(`HF${i + 1}`, { tuningRangeKHz: [500_000, 502_000], channelWidthKHz: 25 }),
    );
    const result = coordinate({
      links,
      config: { enableIm3ThreeTx: false, enableIm5TwoTx: false },
    });
    expect(result.robustness.level).toBeGreaterThan(0);
    expect(result.robustness.guards.spacingKHz).toBeLessThan(300);
    expect(result.robustness.ladderLength).toBe(5);
  });

  it('returns its best partial plan when no ladder level succeeds', () => {
    const links = Array.from({ length: 6 }, (_, i) =>
      link(`HF${i + 1}`, { tuningRangeKHz: [500_000, 500_100], channelWidthKHz: 25 }),
    );
    const result = coordinate({ links });
    expect(result.ok).toBe(false);
    expect(result.unassignedLinkIds.length).toBeGreaterThan(0);
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.stats.ladderLevelsTried).toBe(5);
  });
});

describe('coordinate — determinism', () => {
  it('carries no timing or other unstable data in its result', () => {
    const links = festival();
    expect(JSON.stringify(coordinate({ links, bands: FR_BANDS }))).toBe(
      JSON.stringify(coordinate({ links, bands: FR_BANDS })),
    );
  });
});

describe('coordinate — input validation', () => {
  it('rejects duplicate link ids', () => {
    expect(() => coordinate({ links: [link('A'), link('A')] })).toThrow(/en double/);
  });

  it('rejects an inverted exclusion', () => {
    expect(() =>
      coordinate({
        links: [link('A')],
        exclusions: [{ fromKHz: 550_000, toKHz: 540_000, source: 'manual', label: 'inversée' }],
      }),
    ).toThrow(/inversée/);
  });

  it('keeps every guard invariant through the whole ladder', () => {
    // floor(0.3 × 45) = 13 but floor(0.3 × 90) = 27: without care the scaled
    // guards would fail the very check the nominal ones passed, and the final
    // re-verification would throw on a plan the ladder itself produced.
    const guards = { im3TwoTxKHz: 45, im3ThreeTxKHz: 45, spacingKHz: 45, im5TwoTxKHz: 90, exclusionKHz: 45 };
    const scaled = scaleGuards(guards, 0.3);
    expect(scaled.spacingKHz).toBe(13);
    expect(scaled.im5TwoTxKHz).toBe(26);
    expect(() =>
      coordinate({
        links: [link('A', { tuningRangeKHz: [500_000, 500_015], stepKHz: 5, channelWidthKHz: 5 }), link('B', { tuningRangeKHz: [500_000, 500_015], stepKHz: 5, channelWidthKHz: 5 })],
        config: { guards },
      }),
    ).not.toThrow();
  });

  it('rejects a ladder that does not start at the nominal guards', () => {
    expect(() => coordinate({ links: [link('A')], config: { robustnessLadder: [0.8, 0.5] } })).toThrow(
      /doit valoir 1/,
    );
    expect(() => coordinate({ links: [link('A')], config: { robustnessLadder: [] } })).toThrow(/vide/);
    expect(() => coordinate({ links: [link('A')], config: { robustnessLadder: [1, 0.5, 0.7] } })).toThrow(
      /décroissante/,
    );
    expect(() => coordinate({ links: [link('A')], config: { robustnessLadder: [1, 0] } })).toThrow(/]0, 1]/);
  });
});
