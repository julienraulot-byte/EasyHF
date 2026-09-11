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

  it('reports the guards each link was held to, so a re-check with per-model guards reproduces the verdict', () => {
    // Six links whose own guards are far stricter than the global set, in a
    // 2 MHz range: the ladder has to descend, and the scaled global guards
    // alone would re-check the plan against the wrong numbers.
    const strict = { spacingKHz: 500, im3TwoTxKHz: 400, im3ThreeTxKHz: 200 };
    const links = Array.from({ length: 6 }, (_, i) =>
      link(`L${i}`, { tuningRangeKHz: [500_000, 502_000], channelWidthKHz: 25, guards: strict }),
    );
    const result = coordinate({ links, config: { enableIm5TwoTx: false } });
    expect(result.ok).toBe(true);
    expect(result.robustness.level).toBeGreaterThan(0);

    const held = new Map(result.robustness.linkGuards.map((entry) => [entry.linkId, entry.guards]));
    expect(held.get('L0')?.spacingKHz).toBe(Math.floor(500 * result.robustness.factor));
    const verified = checkPlan({
      links: links.map((l) => ({ ...l, guards: held.get(l.id)! })),
      plan: result.assignments,
      config: { guards: result.robustness.guards, enableIm5TwoTx: false },
    });
    expect(verified.violations).toEqual(result.violations);
    expect(verified.ok).toBe(true);

    // The naive re-check — the global guards only — is not the verification
    // the engine ran, and says so.
    const naive = checkPlan({ links, plan: result.assignments, config: { guards: result.robustness.guards, enableIm5TwoTx: false } });
    expect(naive.ok).toBe(false);
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

  it('enforces exactly the caller\'s guards at the nominal rung, and floors them below it', () => {
    // No guard is ever adjusted behind the caller's back: a plan `coordinate`
    // accepts at level 0 is one `checkPlan` accepts with the same guards.
    // (An IM5 guard above twice the spacing used to be clamped silently.)
    const guards = { im3TwoTxKHz: 50, im3ThreeTxKHz: 0, spacingKHz: 100, im5TwoTxKHz: 300, exclusionKHz: 45 };
    expect(scaleGuards(guards, 1)).toEqual(guards);
    expect(scaleGuards(guards, 0.3)).toEqual({ im3TwoTxKHz: 15, im3ThreeTxKHz: 0, spacingKHz: 30, im5TwoTxKHz: 90, exclusionKHz: 13 });

    // 3 × 500 000 − 2 × 500 300 = 499 400; C sits 250 kHz away: inside 300.
    const locked = (id: string, freqKHz: number) =>
      link(id, { tuningRangeKHz: [freqKHz, freqKHz], channelWidthKHz: 25, lockedFreqKHz: freqKHz });
    const input = { links: [locked('A', 500_000), locked('B', 500_300), locked('C', 499_150)], config: { guards } };
    const planned = coordinate(input);
    const checked = checkPlan({ ...input, plan: planned.assignments });
    expect(planned.robustness.guards).toEqual(guards);
    expect(planned.violations).toEqual(checked.violations);
    expect(checked.violations.map((v) => [v.kind, v.actualKHz])).toEqual([['im5-2tx', 250]]);
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

describe('coordinate — wideband blocks (D-026)', () => {
  const spectera = (id: string) =>
    link(id, { kind: 'wmas', channelWidthKHz: 6_000, tuningRangeKHz: [473_000, 691_000], stepKHz: 125 });

  it('places a 6 MHz block among narrowband links, inside the band and clear of TV channels', () => {
    const links = [spectera('S'), ...Array.from({ length: 10 }, (_, i) => link(`HF${i}`, { tuningRangeKHz: [470_000, 534_000] }))];
    const exclusions = [tntChannel(21), tntChannel(22), tntChannel(25), tntChannel(28)];
    const result = coordinate({ links, exclusions, bands: FR_BANDS });
    expect(result.ok).toBe(true);
    expect(result.robustness.level).toBe(0);
    const block = result.assignments.find((a) => a.linkId === 'S')?.freqKHz as number;
    for (const exclusion of exclusions) {
      expect(block + 3_000 <= exclusion.fromKHz - 250 || block - 3_000 >= exclusion.toKHz + 250, `bloc ${block} vs ${exclusion.label}`).toBe(true);
    }
    for (const entry of result.assignments) {
      if (entry.linkId === 'S') continue;
      expect(Math.abs(entry.freqKHz - block)).toBeGreaterThanOrEqual(3_000 + 100 + 300);
    }
    const verified = checkPlan({ links, plan: result.assignments, exclusions, bands: FR_BANDS });
    expect(verified.ok).toBe(true);
  });

  it('gives the same plan whether the block is listed first or last', () => {
    const narrow = Array.from({ length: 6 }, (_, i) => link(`HF${i}`, { tuningRangeKHz: [470_000, 534_000] }));
    const first = coordinate({ links: [spectera('S'), ...narrow], bands: FR_BANDS });
    const last = coordinate({ links: [...narrow, spectera('S')], bands: FR_BANDS });
    expect(first.assignments).toEqual(last.assignments);
  });
});
