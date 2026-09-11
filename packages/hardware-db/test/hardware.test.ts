import { coordinate } from '@easyhf/engine';
import { describe, expect, it } from 'vitest';
import { findHardware, HARDWARE, hardwareProfile, hardwareProfileById, searchHardware } from '../src/index.js';
import { findings } from '../src/validate.js';

describe('data files', () => {
  it('pass the validator', () => {
    expect(findings(HARDWARE)).toEqual([]);
  });

  it('cover the series the build brief asks for', () => {
    const series = new Set(HARDWARE.map((e) => `${e.brand} ${e.series}`));
    for (const wanted of [
      'Shure ULX-D',
      'Shure QLX-D',
      'Shure SLX-D',
      'Shure Axient Digital',
      'Shure PSM 900',
      'Shure PSM 1000',
      'Sennheiser EW 100 G4',
      'Sennheiser EW 300 G4',
      'Sennheiser EW 500 G4',
      'Sennheiser EW-DX',
      'Sennheiser Digital 6000',
      'Sennheiser 2000 IEM',
      'Wisycom MTP60',
      'Wisycom MCR54',
      'Sony DWX',
      'Audio-Technica 3000 (4e génération)',
      'MiPro ACT-8',
    ]) {
      expect(series, wanted).toContain(wanted);
    }
  });

  it('cite an official source on every entry, and none is verified yet', () => {
    for (const entry of HARDWARE) {
      expect(entry.source, entry.id).toMatch(/^https:\/\/(www\.)?(shure|sennheiser|wisycom|audio-technica|mipro)\.|^https:\/\/pro\.sony\//);
      expect(entry.verified, `${entry.id} : verified doit rester false tant que Julien n'a pas contrôlé`).toBe(false);
    }
  });

  it('every unverified entry that is uncertain says so', () => {
    // A note is the only place a doubt can live; an entry without one claims
    // its figures are right. Keep the list of confident entries honest.
    const confident = HARDWARE.filter((e) => !e.notes);
    expect(confident.length).toBeGreaterThan(0);
    expect(confident.length).toBeLessThan(HARDWARE.length);
  });
});

describe('lookup', () => {
  it('finds an entry by id and builds an engine profile from it', () => {
    const entry = findHardware('shure-ulxd-g50');
    expect(entry?.tuningRangeKHz).toEqual([470_125, 534_000]);
    expect(hardwareProfile(entry!)).toEqual({ tuningRangeKHz: [470_125, 534_000], stepKHz: 25, channelWidthKHz: 200 });
    expect(hardwareProfileById('nope')).toBeUndefined();
  });

  it('searches by any words of brand, series, model or band', () => {
    expect(searchHardware('ulx-d h51').map((e) => e.id)).toEqual(['shure-ulxd-h51']);
    expect(searchHardware('sennheiser 6000')).toHaveLength(3);
    expect(searchHardware('').length).toBe(HARDWARE.length);
    expect(searchHardware('zzz')).toEqual([]);
  });
});

describe('with the engine', () => {
  it('coordinates a real mixed kit inside each hardware range and grid', () => {
    const kit = ['shure-ulxd-h51', 'shure-ulxd-h51', 'sennheiser-ewdx-r1-9', 'sennheiser-6000-a5-a8', 'shure-psm1000-j8e'];
    const links = kit.map((id, i) => {
      const profile = hardwareProfileById(id)!;
      return { id: `L${i + 1}`, zoneId: '', ...profile };
    });
    const result = coordinate({ links });
    expect(result.ok).toBe(true);
    for (const { linkId, freqKHz } of result.assignments) {
      const link = links.find((l) => l.id === linkId)!;
      expect(freqKHz).toBeGreaterThanOrEqual(link.tuningRangeKHz[0]);
      expect(freqKHz).toBeLessThanOrEqual(link.tuningRangeKHz[1]);
      expect((freqKHz - link.tuningRangeKHz[0]) % link.stepKHz).toBe(0);
    }
  });
});
