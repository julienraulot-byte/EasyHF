import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import { link, tntChannel } from './fixtures/links.js';
import type { EngineBand, EngineLink } from '../src/types.js';

const FR_BANDS: EngineBand[] = [
  { fromKHz: 470_000, toKHz: 694_000, status: 'free', label: 'UHF 470–694' },
  { fromKHz: 694_000, toKHz: 790_000, status: 'forbidden', label: 'Bande 700' },
];

/** A realistic 24-link, 2-zone festival load spread over three hardware families. */
function festival(): EngineLink[] {
  const links: EngineLink[] = [];
  for (let i = 0; i < 12; i += 1) {
    links.push(
      link(`SC1-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene1',
        tuningRangeKHz: [534_000, 598_000],
        stepKHz: 25,
      }),
    );
  }
  for (let i = 0; i < 8; i += 1) {
    links.push(
      link(`SC2-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene2',
        tuningRangeKHz: [606_000, 678_000],
        stepKHz: 25,
      }),
    );
  }
  for (let i = 0; i < 4; i += 1) {
    links.push(
      link(`IEM-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene1',
        tuningRangeKHz: [606_000, 630_000],
        stepKHz: 125,
        channelWidthKHz: 300,
      }),
    );
  }
  return links;
}

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
  it('returns an identical plan whatever order the links arrive in', () => {
    const links = festival();
    const shuffled = [...links].reverse();
    const a = coordinate({ links, bands: FR_BANDS });
    const b = coordinate({ links: shuffled, bands: FR_BANDS });
    expect(b.assignments).toEqual(a.assignments);
    expect(b.violations).toEqual(a.violations);
    expect(b.robustness).toEqual(a.robustness);
  });

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
