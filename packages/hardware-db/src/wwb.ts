/**
 * Comparison against Shure's Wireless Workbench equipment database.
 *
 * WWB ships its whole equipment database as an unencrypted SQLite file inside
 * the application bundle (D-029). It holds, for every series and band variant
 * it knows, the real tunable range, the tuning step, and the compatibility
 * profiles — the very numbers phase 1 has to confirm.
 *
 * This module is the pure half: it knows nothing about SQLite or the file
 * system, and turns rows into findings. `import-wwb.ts` reads the database on
 * the user's own machine and feeds it here. **Nothing from that database is
 * ever committed to this repository** — it is Shure's, licensed to the user,
 * not to us.
 */

import type { Guards } from '@easyhf/engine';
import type { HardwareEntry } from './types.js';

/** One band variant of one series, as WWB stores it. Frequencies in kHz. */
export interface WwbBand {
  manufacturer: string;
  series: string;
  band: string;
  fromKHz: number;
  toKHz: number;
  stepKHz: number;
  /** Tunable sub-ranges, when the band has holes. Empty when contiguous. */
  subRangesKHz: readonly (readonly [number, number])[];
  profiles: readonly WwbProfile[];
}

/** A compatibility profile: one RF mode at one of the three WWB levels. */
export interface WwbProfile {
  /** WWB's RF profile, e.g. `Standard`, `HD`, `Narrowband`. */
  rfProfile: string;
  /** The three levels of the Compatibility slider, under their UI names. */
  level: 'Standard' | 'Robust' | 'More Frequencies';
  /** Whether WWB counts this device as a source of intermodulation products. */
  isImdSource: boolean;
  guards: Pick<Guards, 'spacingKHz' | 'im3TwoTxKHz' | 'im3ThreeTxKHz' | 'im5TwoTxKHz'>;
  /** 7th and 9th order spacings, which EasyHF does not model. 0 when unused. */
  unmodelledKHz: { twoTx7thKHz: number; twoTx9thKHz: number };
}

export type FindingKind =
  | 'range-differs'
  | 'step-differs'
  | 'sub-ranges'
  | 'not-in-wwb'
  | 'unmodelled-order'
  | 'match';

export interface Finding {
  kind: FindingKind;
  entryId: string;
  message: string;
}

/** WWB stores frequencies in MHz for most series and in Hz for a few. */
export function toKHz(value: number): number {
  let khz = value;
  for (let i = 0; i < 3 && khz < 100_000; i += 1) khz *= 1000;
  while (khz > 2_000_000) khz /= 1000;
  return Math.round(khz);
}

const mhz = (khz: number): string => (khz / 1000).toFixed(3);

/**
 * Matches an entry to the WWB bands of the same manufacturer and band code.
 * A band code is unique within a manufacturer but shared across series (a
 * Shure G51 is the same spectrum on ULX-D and QLX-D), so the series name
 * narrows it when it can.
 */
export function findBands(entry: HardwareEntry, bands: readonly WwbBand[]): WwbBand[] {
  const sameCode = bands.filter(
    (b) =>
      b.manufacturer.toLowerCase() === entry.brand.toLowerCase() &&
      b.band.toUpperCase() === entry.bandVariant.toUpperCase(),
  );
  const key = entry.series.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const sameSeries = sameCode.filter((b) => b.series.replace(/[^a-z0-9]/gi, '').toLowerCase() === key);
  return sameSeries.length > 0 ? sameSeries : sameCode;
}

/** What WWB says about each entry, one finding per difference. */
export function compareToWwb(entries: readonly HardwareEntry[], bands: readonly WwbBand[]): Finding[] {
  const findings: Finding[] = [];
  for (const entry of entries) {
    if (entry.type === 'wmas') continue; // WWB has no WMAS block model.
    const candidates = findBands(entry, bands);
    if (candidates.length === 0) {
      findings.push({
        kind: 'not-in-wwb',
        entryId: entry.id,
        message: `${entry.brand} ${entry.series} ${entry.bandVariant} est absent de la base WWB : à vérifier sur la documentation du constructeur.`,
      });
      continue;
    }
    const [from, to] = entry.tuningRangeKHz;
    const exact = candidates.find((b) => b.fromKHz === from && b.toKHz === to);
    const band = exact ?? (candidates[0] as WwbBand);
    if (!exact) {
      findings.push({
        kind: 'range-differs',
        entryId: entry.id,
        message: `plage ${mhz(from)}–${mhz(to)} MHz chez nous, ${mhz(band.fromKHz)}–${mhz(band.toKHz)} MHz dans WWB (série ${band.series}).`,
      });
    }
    if (band.stepKHz !== entry.stepKHz) {
      findings.push({
        kind: 'step-differs',
        entryId: entry.id,
        message:
          band.stepKHz === 0
            ? `pas d'accord ${entry.stepKHz} kHz chez nous, mais WWB donne 0 : cet appareil ne s'accorde pas librement, il n'offre que des canaux préréglés (D-017).`
            : `pas d'accord ${entry.stepKHz} kHz chez nous, ${band.stepKHz} kHz dans WWB.`,
      });
    }
    if (band.subRangesKHz.length > 1) {
      const spans = band.subRangesKHz.map(([a, b]) => `${mhz(a)}–${mhz(b)}`).join(', ');
      findings.push({
        kind: 'sub-ranges',
        entryId: entry.id,
        message: `la bande a ${band.subRangesKHz.length} sous-plages accordables (${spans} MHz) ; notre entrée n'en décrit qu'une seule.`,
      });
    }
    for (const profile of band.profiles) {
      const { twoTx7thKHz, twoTx9thKHz } = profile.unmodelledKHz;
      if (twoTx7thKHz > 0 || twoTx9thKHz > 0) {
        findings.push({
          kind: 'unmodelled-order',
          entryId: entry.id,
          message: `profil ${profile.rfProfile}/${profile.level} : WWB garde ${twoTx7thKHz} kHz au 7e ordre et ${twoTx9thKHz} kHz au 9e, que le moteur ne modélise pas.`,
        });
      }
    }
    if (exact && band.stepKHz === entry.stepKHz && band.subRangesKHz.length <= 1) {
      findings.push({ kind: 'match', entryId: entry.id, message: `conforme à WWB (série ${band.series}).` });
    }
  }
  return findings;
}
