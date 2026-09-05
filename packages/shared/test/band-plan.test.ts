import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BandPlan } from '../src/domain.js';

/**
 * `data/bands/fr.json` is regulatory data, not code: it will be edited when the
 * ARCEP or the ANFR moves, possibly in a hurry, possibly not by a developer.
 * These checks are what stands between an edit and a plan built on a bad band.
 */
const plan = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/bands/fr.json', import.meta.url)), 'utf8'),
) as BandPlan;

describe('data/bands/fr.json', () => {
  it('declares the country, the review date and its regulatory sources', () => {
    expect(plan.country).toBe('FR');
    expect(plan.updated).toMatch(/^\d{4}-\d{2}$/);
    expect(plan.sources.length).toBeGreaterThan(0);
    for (const source of plan.sources) expect(source.length).toBeGreaterThan(20);
  });

  it('holds well-formed, ordered, non-overlapping bands', () => {
    let previousToKHz = 0;
    for (const band of plan.bands) {
      expect(Number.isInteger(band.fromKHz)).toBe(true);
      expect(Number.isInteger(band.toKHz)).toBe(true);
      expect(band.toKHz).toBeGreaterThan(band.fromKHz);
      expect(['free', 'temporary', 'forbidden']).toContain(band.status);
      expect(band.fromKHz).toBeGreaterThanOrEqual(previousToKHz);
      previousToKHz = band.toKHz;
    }
  });

  it('carries the four French PMSE bands and the 700 MHz ban', () => {
    const byRange = new Map(plan.bands.map((b) => [`${b.fromKHz}-${b.toKHz}`, b]));
    for (const range of ['174000-223000', '470000-694000', '823000-832000', '1785000-1800000']) {
      expect(byRange.get(range)?.status, range).toBe('free');
    }
    expect(byRange.get('694000-790000')?.status).toBe('forbidden');
  });

  it('explains every band that is neither plainly free nor plainly forbidden', () => {
    for (const band of plan.bands.filter((b) => b.status === 'temporary')) {
      expect(band.note, `${band.label} sans note`).toBeTruthy();
    }
  });
});
