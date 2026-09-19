import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWwbBands } from '../src/import-wwb.js';
import { compareToWwb, findBands, toKHz, type WwbBand } from '../src/wwb.js';
import type { HardwareEntry } from '../src/types.js';

const entry = (over: Partial<HardwareEntry> = {}): HardwareEntry => ({
  id: 'test-entry',
  brand: 'Shure',
  series: 'ULX-D',
  model: 'ULXD4',
  bandVariant: 'G51',
  type: 'receiver',
  tuningRangeKHz: [470_125, 534_000],
  stepKHz: 25,
  channelWidthKHz: 200,
  source: 'https://www.shure.com/x',
  provenance: 'manufacturer',
  ...over,
});

const band = (over: Partial<WwbBand> = {}): WwbBand => ({
  manufacturer: 'Shure',
  series: 'ULXD',
  band: 'G51',
  fromKHz: 470_125,
  toKHz: 534_000,
  stepKHz: 25,
  subRangesKHz: [],
  profiles: [],
  ...over,
});

describe('toKHz', () => {
  it('normalises the units WWB actually uses', () => {
    expect(toKHz(470.125)).toBe(470_125); // MHz, most series
    expect(toKHz(470_200_000)).toBe(470_200); // kHz, the Lectrosonics and EW-D rows
    expect(toKHz(1_785_200)).toBe(1_785_200); // already kHz
  });
});

describe('findBands', () => {
  it('prefers the band of the same series, ignoring punctuation and case', () => {
    const bands = [band({ series: 'QLXD' }), band({ series: 'ULXD', toKHz: 533_975 })];
    const match = findBands(entry(), bands);
    expect(match.how).toBe('series');
    expect(match.bands.map((b) => b.toKHz)).toEqual([533_975]);
  });

  it('says the band is missing rather than borrowing another series that has it', () => {
    // WWB knows ULX-D, just not this code: silently comparing against QLX-D's
    // G51 would report "conforme" and hide the real discrepancy.
    const bands = [band({ series: 'QLXD' }), band({ series: 'ULXD', band: 'H51' })];
    expect(findBands(entry(), bands)).toEqual({ bands: [], how: 'band-missing' });
  });

  it('falls back across series only when WWB does not know the series at all', () => {
    const bands = [band({ series: 'QLXD' }), band({ series: 'SLXD' })];
    const match = findBands(entry({ series: 'Unknown Series' }), bands);
    expect(match.how).toBe('other-series');
    expect(match.bands).toHaveLength(2);
  });

  it('maps our series names onto the abbreviations WWB uses', () => {
    const adpsm = entry({ series: 'Axient Digital PSM', bandVariant: 'K55' });
    const bands = [band({ series: 'AD', band: 'K55' }), band({ series: 'ADPSM', band: 'K55', fromKHz: 606_000 })];
    const match = findBands(adpsm, bands);
    expect(match.how).toBe('series');
    expect(match.bands.map((b) => b.fromKHz)).toEqual([606_000]);
  });

  it('ignores punctuation in band codes, which WWB drops', () => {
    const d6000 = entry({ brand: 'Sennheiser', series: 'Digital 6000', bandVariant: 'A1-A4' });
    const bands = [band({ manufacturer: 'Sennheiser', series: 'EM 6000', band: 'A1A4', fromKHz: 470_200 })];
    expect(findBands(d6000, bands).how).toBe('series');
  });
});

describe('compareToWwb', () => {
  it('says nothing but "match" when range and step agree', () => {
    expect(compareToWwb([entry()], [band()])).toEqual([
      { kind: 'match', entryId: 'test-entry', message: 'conforme à WWB (série ULXD).' },
    ]);
  });

  it('reports a range that is off by a tuning step', () => {
    const findings = compareToWwb([entry({ tuningRangeKHz: [470_000, 534_000] })], [band()]);
    expect(findings.map((f) => f.kind)).toEqual(['range-differs']);
    expect(findings[0]?.message).toContain('470.000–534.000 MHz chez nous, 470.125–534.000 MHz dans WWB');
  });

  it('reads a step of zero as a preset-only device rather than a typo', () => {
    const findings = compareToWwb([entry()], [band({ stepKHz: 0 })]);
    expect(findings.map((f) => f.kind)).toEqual(['step-differs']);
    expect(findings[0]?.message).toContain('canaux préréglés');
  });

  it('flags a band with holes, which one range cannot describe', () => {
    const holes = band({ subRangesKHz: [[470_125, 480_000], [500_000, 534_000]] });
    expect(compareToWwb([entry()], [holes]).map((f) => f.kind)).toEqual(['sub-ranges']);
  });

  it('flags the orders the engine does not model, and only when they are used', () => {
    const guards = { spacingKHz: 350, im3TwoTxKHz: 75, im3ThreeTxKHz: 0, im5TwoTxKHz: 0 };
    const withOrders = band({
      profiles: [
        { rfProfile: 'Standard', level: 'Standard', isImdSource: true, guards, unmodelledKHz: { twoTx7thKHz: 0, twoTx9thKHz: 0 } },
        { rfProfile: 'Standard', level: 'Robust', isImdSource: true, guards, unmodelledKHz: { twoTx7thKHz: 100, twoTx9thKHz: 0 } },
      ],
    });
    const findings = compareToWwb([entry()], [withOrders]);
    expect(findings.map((f) => f.kind)).toEqual(['unmodelled-order', 'match']);
    expect(findings[0]?.message).toContain('7e ordre');
  });

  it('says when an entry is unknown to WWB, and skips WMAS blocks entirely', () => {
    expect(compareToWwb([entry({ brand: 'Wisycom' })], [band()]).map((f) => f.kind)).toEqual(['not-in-wwb']);
    expect(compareToWwb([entry({ type: 'wmas', brand: 'Sennheiser' })], [band()])).toEqual([]);
  });
});

describe('readWwbBands', () => {
  /** A miniature of the real schema, with the joins the reader depends on. */
  function fixture(): string {
    const path = join(mkdtempSync(join(tmpdir(), 'easyhf-wwb-')), 'PrePackagedSeries2.3ds');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE Manufacturers (manufacturer_id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE Series (series_id INTEGER PRIMARY KEY, name TEXT, manufacturer_fk INTEGER);
      CREATE TABLE Models (model_id INTEGER PRIMARY KEY, name TEXT, series_fk INTEGER);
      CREATE TABLE Bands (band_id INTEGER PRIMARY KEY, name TEXT, frequency_start REAL, frequency_end REAL, step_size REAL);
      CREATE TABLE model_band (model_band_id INTEGER PRIMARY KEY, model_fk INTEGER, band_fk INTEGER);
      CREATE TABLE band_ranges (band_ranges_id INTEGER PRIMARY KEY, first_tunable REAL, last_tunable REAL, band_fk INTEGER);
      CREATE TABLE RfProfiles (rf_profile_id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE Spacing (spacing_id INTEGER PRIMARY KEY,
        median_ch_to_ch REAL, median_ch_to_2t3o REAL, median_ch_to_2t5o REAL, median_ch_to_2t7o REAL, median_ch_to_2t9o REAL, median_ch_to_3t3o REAL,
        robust_ch_to_ch REAL, robust_ch_to_2t3o REAL, robust_ch_to_2t5o REAL, robust_ch_to_2t7o REAL, robust_ch_to_2t9o REAL, robust_ch_to_3t3o REAL,
        quantity_ch_to_ch REAL, quantity_ch_to_2t3o REAL, quantity_ch_to_2t5o REAL, quantity_ch_to_2t7o REAL, quantity_ch_to_2t9o REAL, quantity_ch_to_3t3o REAL);
      CREATE TABLE FilterRanges (filter_range_id INTEGER PRIMARY KEY);
      CREATE TABLE filter_spacing (filter_spacing_id INTEGER PRIMARY KEY, spacing_fk INTEGER, filter_range_fk INTEGER);
      CREATE TABLE series_spacing_rules (id INTEGER PRIMARY KEY, series_fk INTEGER, band_fk INTEGER, rf_profile_fk INTEGER, filter_spacing_fk INTEGER, is_imd_source INTEGER);
      INSERT INTO Manufacturers VALUES (1, 'Shure');
      INSERT INTO Series VALUES (1, 'ULXD', 1);
      INSERT INTO Models VALUES (1, 'ULXD4', 1);
      INSERT INTO Bands VALUES (1, 'G51', 470.125, 534.0, 25);
      INSERT INTO model_band VALUES (1, 1, 1);
      INSERT INTO band_ranges VALUES (1, 500.0, 534.0, 1), (2, 470.125, 480.0, 1);
      INSERT INTO RfProfiles VALUES (1, 'Standard');
      INSERT INTO Spacing VALUES (1, 350,75,0,0,0,0, 350,150,0,0,0,0, 350,0,0,0,0,0);
      INSERT INTO FilterRanges VALUES (1);
      INSERT INTO filter_spacing VALUES (1, 1, 1);
      INSERT INTO series_spacing_rules VALUES (1, 1, 1, 1, 1, 1);
    `);
    db.close();
    return path;
  }

  it('reads bands, sorted sub-ranges and the three compatibility levels', async () => {
    const bands = await readWwbBands(fixture());
    expect(bands).toHaveLength(1);
    const [only] = bands as [WwbBand];
    expect(only).toMatchObject({ manufacturer: 'Shure', series: 'ULXD', band: 'G51', fromKHz: 470_125, toKHz: 534_000, stepKHz: 25 });
    expect(only.subRangesKHz).toEqual([[470_125, 480_000], [500_000, 534_000]]);

    // The WWB column names map onto the slider: median = Standard, quantity =
    // More Frequencies. These are the values read off Julien's own screen.
    expect(only.profiles.map((p) => [p.level, p.guards.spacingKHz, p.guards.im3TwoTxKHz])).toEqual([
      ['Standard', 350, 75],
      ['Robust', 350, 150],
      ['More Frequencies', 350, 0],
    ]);
    expect(only.profiles.every((p) => p.isImdSource)).toBe(true);
  });
});

describe('compareToWwb — bands with holes', () => {
  const holed = band({
    subRangesKHz: [
      [470_125, 480_000],
      [500_000, 534_000],
    ],
  });

  it('says nothing when our sub-ranges match WWB, and counts the entry as conforming', () => {
    const ours = entry({ tunableRangesKHz: [[470_125, 480_000], [500_000, 534_000]] });
    expect(compareToWwb([ours], [holed]).map((f) => f.kind)).toEqual(['match']);
  });

  it('reports a difference rather than the mere presence of holes', () => {
    const wrong = entry({ tunableRangesKHz: [[470_125, 481_000], [500_000, 534_000]] });
    const findings = compareToWwb([wrong], [holed]);
    expect(findings.map((f) => f.kind)).toEqual(['sub-ranges']);
    expect(findings[0]?.message).toContain('sous-plages différentes');
  });

  it('reports an entry claiming holes WWB does not have', () => {
    const invented = entry({ tunableRangesKHz: [[470_125, 480_000], [500_000, 534_000]] });
    const findings = compareToWwb([invented], [band()]);
    expect(findings.map((f) => f.kind)).toEqual(['sub-ranges']);
    expect(findings[0]?.message).toContain("WWB ne connaît pas");
  });
});
