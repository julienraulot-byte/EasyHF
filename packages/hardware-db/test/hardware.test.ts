import { coordinate, type EngineBand } from '@easyhf/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findHardware, HARDWARE, hardwareProfile, hardwareProfileById, searchHardware } from '../src/index.js';
import { findings } from '../src/validate.js';

/** The French band plan, from the one file the product ships. */
const FR_BANDS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/bands/fr.json', import.meta.url)), 'utf8'),
).bands as EngineBand[];

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
      'Shure Axient Digital PSM',
      'Sennheiser Spectera',
      'Sound Devices Astral',
    ]) {
      expect(series, wanted).toContain(wanted);
    }
  });

  it('cite an official source on every entry, and none is verified yet', () => {
    for (const entry of HARDWARE) {
      expect(entry.source, entry.id).toMatch(
        /^https:\/\/(www\.|pubs\.|docs\.cloud\.)?(shure|sennheiser|wisycom|audio-technica|mipro|sounddevices)\.|^https:\/\/pro\.sony\//,
      );
      expect(entry.verified, `${entry.id} : verified doit rester false tant que Julien n'a pas contrôlé`).toBe(false);
    }
  });

});

describe('validator', () => {
  const base = findHardware('shure-ulxd-g51')!;

  it('rejects a range whose upper bound is off the tuning grid', () => {
    const entry = { ...base, id: 'test-off-grid', tuningRangeKHz: [470_000, 534_010] as [number, number] };
    expect(findings([entry])).toEqual([
      "test-off-grid : la borne haute 534010 kHz n'est pas sur la grille de 25 kHz depuis 470000",
    ]);
  });

  it('rejects a wideband width on anything but a WMAS entry', () => {
    const wide = { ...base, id: 'test-wide', channelWidthKHz: 6_000 };
    expect(findings([wide])).toEqual(['test-wide : largeur de canal 6000 kHz invraisemblable pour le type receiver']);
    expect(findings([{ ...wide, type: 'wmas' as const }])).toEqual([]);
  });

  it('rejects a WMAS range too narrow to give its block centre a position', () => {
    // The profile builder insets each end by half a block rounded up to the
    // grid, so a range under twice that inset yields an inverted centre range.
    const narrow = { ...base, id: 'test-narrow-wmas', type: 'wmas' as const, channelWidthKHz: 6_000, tuningRangeKHz: [470_000, 475_000] as [number, number] };
    expect(findings([narrow])).toEqual([
      "test-narrow-wmas : plage 470000–475000 kHz trop étroite pour un bloc de 6000 kHz (le centre n'a aucune position valable)",
    ]);
    // Exactly one block wide is accepted and leaves the centre one position.
    const exact = { ...narrow, id: 'test-exact-wmas', tuningRangeKHz: [470_000, 476_000] as [number, number] };
    expect(findings([exact])).toEqual([]);
    expect(hardwareProfile(exact).tuningRangeKHz).toEqual([473_000, 473_000]);
  });

  it('rejects a duplicate id', () => {
    expect(findings([base, base])).toEqual(['shure-ulxd-g51 : identifiant en double']);
  });
});

describe('lookup', () => {
  it('finds an entry by id and builds an engine profile from it', () => {
    const entry = findHardware('shure-ulxd-g50');
    expect(entry?.tuningRangeKHz).toEqual([470_125, 534_000]);
    expect(hardwareProfile(entry!)).toEqual({ tuningRangeKHz: [470_125, 534_000], stepKHz: 25, channelWidthKHz: 200 });
    expect(hardwareProfileById('nope')).toBeUndefined();
  });

  it('turns a WMAS entry into a block whose centre keeps it inside the RF range', () => {
    // ZONE 01 lower UHF segment is 470–608 MHz: a 6 MHz block centres between
    // 473 and 605 MHz, an 8 MHz one between 474 and 604.
    const profile = hardwareProfileById('sennheiser-spectera-uhf-basse-6mhz')!;
    expect(profile).toMatchObject({ kind: 'wmas', channelWidthKHz: 6_000, tuningRangeKHz: [473_000, 605_000] });
    expect(hardwareProfileById('sennheiser-spectera-uhf-basse-8mhz')?.tuningRangeKHz).toEqual([474_000, 604_000]);
    expect(hardwareProfileById('sennheiser-spectera-uhf-haute-8mhz')?.tuningRangeKHz).toEqual([634_000, 694_000]);
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

  it('places a real Spectera block among narrowband kit, inside the French band plan', () => {
    const kit = [
      'sennheiser-spectera-uhf-basse-8mhz',
      'shure-ulxd-g51',
      'shure-ulxd-g51',
      'shure-adpsm-g56',
      'sennheiser-ewdx-q1-9',
    ];
    const links = kit.map((id, i) => {
      const profile = hardwareProfileById(id)!;
      return { id: `L${i + 1}`, zoneId: 'scene', ...profile };
    });
    const result = coordinate({ links, bands: FR_BANDS });
    expect(result.ok).toBe(true);

    // The whole 8 MHz block sits inside the 470–694 MHz French band, and every
    // narrowband carrier stays clear of its edges.
    const block = result.assignments.find((a) => a.linkId === 'L1')!.freqKHz;
    expect(block - 4_000).toBeGreaterThanOrEqual(470_000);
    expect(block + 4_000).toBeLessThanOrEqual(694_000);
    for (const { linkId, freqKHz } of result.assignments) {
      if (linkId === 'L1') continue;
      expect(Math.abs(freqKHz - block), `${linkId} à ${freqKHz} kHz`).toBeGreaterThan(4_000);
    }
  });
});
