import { coordinate } from '@easyhf/engine';
import { describe, expect, it } from 'vitest';
import { applyPlan, toCoordinateInput, UnknownHardwareError } from '../src/engine-bridge.js';
import type { BandPlan, Project } from '../src/domain.js';

const HARDWARE = {
  'shure-ulxd-h51': { tuningRangeKHz: [534_000, 598_000] as const, stepKHz: 25, channelWidthKHz: 200 },
  'sennheiser-ew-dx-s2': { tuningRangeKHz: [606_000, 678_000] as const, stepKHz: 25, channelWidthKHz: 200 },
};
const lookup = (ref: string) => HARDWARE[ref as keyof typeof HARDWARE];

const BAND_PLAN: BandPlan = {
  country: 'FR',
  updated: '2026-09',
  sources: ['Décision ARCEP 2015-0830'],
  bands: [
    { fromKHz: 470_000, toKHz: 694_000, status: 'free', maxERPmW: 50 },
    { fromKHz: 694_000, toKHz: 790_000, status: 'forbidden' },
  ],
};

function project(): Project {
  return {
    id: 'p1',
    name: 'Festival démo',
    venue: { label: 'Parc des expositions' },
    scans: [],
    exclusions: [{ fromKHz: 542_000, toKHz: 550_000, source: 'tnt-anfr', label: 'Canal TNT 30' }],
    engineConfig: {},
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    zones: [
      {
        id: 'scene1',
        name: 'Grande scène',
        interZonePolicy: 'full-intermod',
        links: [
          { id: 'HF01', label: 'HF01 — Chant', hardwareRef: 'shure-ulxd-h51', role: 'mic', locked: false },
          { id: 'HF02', label: 'HF02 — Guitare', hardwareRef: 'shure-ulxd-h51', role: 'mic', locked: false },
          {
            id: 'HF03',
            label: 'HF03 — Imposée',
            hardwareRef: 'shure-ulxd-h51',
            role: 'mic',
            locked: true,
            assignedFreqKHz: 560_000,
          },
        ],
      },
      {
        id: 'scene2',
        name: 'Petite scène',
        interZonePolicy: 'spacing-only',
        links: [
          { id: 'IEM01', label: 'IEM01 — Retour', hardwareRef: 'sennheiser-ew-dx-s2', role: 'iem', locked: false },
        ],
      },
    ],
  };
}

describe('toCoordinateInput', () => {
  it('flattens zones into links carrying their hardware constraints', () => {
    const input = toCoordinateInput(project(), lookup, BAND_PLAN);
    expect(input.links.map((l) => l.id)).toEqual(['HF01', 'HF02', 'HF03', 'IEM01']);
    expect(input.links[0]?.zoneId).toBe('scene1');
    expect(input.links[0]?.tuningRangeKHz).toEqual([534_000, 598_000]);
    expect(input.links[3]?.tuningRangeKHz).toEqual([606_000, 678_000]);
  });

  it('carries the zone policies and the band plan through', () => {
    const input = toCoordinateInput(project(), lookup, BAND_PLAN);
    expect(input.zonePolicies).toEqual({ scene1: 'full-intermod', scene2: 'spacing-only' });
    expect(input.bands).toEqual(BAND_PLAN.bands);
    expect(input.exclusions).toHaveLength(1);
  });

  it('locks only the links the operator actually locked', () => {
    const input = toCoordinateInput(project(), lookup, BAND_PLAN);
    expect(input.links.find((l) => l.id === 'HF03')?.lockedFreqKHz).toBe(560_000);
    expect(input.links.find((l) => l.id === 'HF01')?.lockedFreqKHz).toBeUndefined();
  });

  it('ignores a locked flag with no frequency behind it', () => {
    const p = project();
    (p.zones[0]?.links[0] as { locked: boolean }).locked = true;
    expect(toCoordinateInput(p, lookup, BAND_PLAN).links[0]?.lockedFreqKHz).toBeUndefined();
  });

  it('names the link and the model when the hardware is missing', () => {
    const p = project();
    (p.zones[0]?.links[0] as { hardwareRef: string }).hardwareRef = 'inconnu-x1';
    expect(() => toCoordinateInput(p, lookup, BAND_PLAN)).toThrow(UnknownHardwareError);
    expect(() => toCoordinateInput(p, lookup, BAND_PLAN)).toThrow(/HF01.*inconnu-x1/);
  });

  it('works without a band plan', () => {
    expect(toCoordinateInput(project(), lookup).bands).toBeUndefined();
  });
});

describe('applyPlan', () => {
  it('writes the coordinated frequencies back into the project', () => {
    const before = project();
    const result = coordinate(toCoordinateInput(before, lookup, BAND_PLAN));
    const after = applyPlan(before, result, '2026-09-05T11:00:00.000Z');

    expect(result.ok).toBe(true);
    const freqs = after.zones.flatMap((z) => z.links.map((l) => l.assignedFreqKHz));
    expect(freqs.every((f) => typeof f === 'number')).toBe(true);
    expect(after.zones[0]?.links[2]?.assignedFreqKHz).toBe(560_000);
    expect(after.engineVersion).toBe(result.engineVersion);
    expect(after.updatedAt).toBe('2026-09-05T11:00:00.000Z');
    expect(before.zones[0]?.links[0]?.assignedFreqKHz).toBeUndefined();
  });

  it('clears the frequency of a link the engine could not place', () => {
    const before = project();
    const stale = applyPlan(
      { ...before, zones: before.zones.map((z) => ({ ...z, links: z.links.map((l) => ({ ...l, assignedFreqKHz: 500_000 })) })) },
      { ...coordinate(toCoordinateInput(before, lookup, BAND_PLAN)), assignments: [] },
      '2026-09-05T11:00:00.000Z',
    );
    expect(stale.zones.flatMap((z) => z.links.map((l) => l.assignedFreqKHz))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
