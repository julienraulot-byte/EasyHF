/**
 * Reads Shure's Wireless Workbench equipment database and reports what it says
 * about our entries (D-029).
 *
 *   pnpm --filter @easyhf/hardware-db import:wwb [chemin vers PrePackagedSeries2.3ds]
 *
 * The database belongs to Shure and is licensed to whoever installed WWB, so it
 * is read where it lies, on the user's own machine, and never copied into this
 * repository. The output is a report to read, not a patch to apply: an entry
 * only becomes `verified: true` once a human has confirmed it (D-024).
 */

import { DatabaseSync } from 'node:sqlite';
import { HARDWARE } from './index.js';
import { compareToWwb, toKHz, type Finding, type WwbBand, type WwbProfile } from './wwb.js';

/** Where WWB 7 keeps it, per platform. */
export const DEFAULT_PATHS = [
  '/Applications/Wireless Workbench.app/Contents/Resources/PrePackagedSeries2.3ds',
  'C:\\Program Files\\Shure\\Wireless Workbench 7\\PrePackagedSeries2.3ds',
  'C:\\Program Files\\Shure\\Wireless Workbench 6\\PrePackagedSeries2.3ds',
] as const;

const LEVELS = [
  { prefix: 'median', level: 'Standard' },
  { prefix: 'robust', level: 'Robust' },
  { prefix: 'quantity', level: 'More Frequencies' },
] as const;

interface Row {
  [column: string]: string | number | null;
}

/** Every band variant WWB knows, with its compatibility profiles. */
export function readWwbBands(path: string): WwbBand[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const bandRows = db
      .prepare(
        `SELECT DISTINCT mf.name manufacturer, s.name series, b.band_id id, b.name band,
                b.frequency_start fs, b.frequency_end fe, b.step_size step
         FROM Bands b
         JOIN model_band mb ON mb.band_fk = b.band_id
         JOIN Models m ON m.model_id = mb.model_fk
         JOIN Series s ON s.series_id = m.series_fk
         JOIN Manufacturers mf ON mf.manufacturer_id = s.manufacturer_fk`,
      )
      .all() as Row[];

    const subRanges = new Map<number, [number, number][]>();
    for (const r of db.prepare('SELECT band_fk, first_tunable, last_tunable FROM band_ranges').all() as Row[]) {
      const list = subRanges.get(Number(r.band_fk)) ?? [];
      list.push([toKHz(Number(r.first_tunable)), toKHz(Number(r.last_tunable))]);
      subRanges.set(Number(r.band_fk), list);
    }

    const profileRows = db
      .prepare(
        `SELECT ssr.band_fk band, s.name series, rp.name profile, ssr.is_imd_source imd,
                sp.median_ch_to_ch, sp.median_ch_to_2t3o, sp.median_ch_to_2t5o,
                sp.median_ch_to_2t7o, sp.median_ch_to_2t9o, sp.median_ch_to_3t3o,
                sp.robust_ch_to_ch, sp.robust_ch_to_2t3o, sp.robust_ch_to_2t5o,
                sp.robust_ch_to_2t7o, sp.robust_ch_to_2t9o, sp.robust_ch_to_3t3o,
                sp.quantity_ch_to_ch, sp.quantity_ch_to_2t3o, sp.quantity_ch_to_2t5o,
                sp.quantity_ch_to_2t7o, sp.quantity_ch_to_2t9o, sp.quantity_ch_to_3t3o
         FROM series_spacing_rules ssr
         JOIN Series s ON s.series_id = ssr.series_fk
         JOIN RfProfiles rp ON rp.rf_profile_id = ssr.rf_profile_fk
         JOIN filter_spacing fs ON fs.filter_spacing_id = ssr.filter_spacing_fk
         JOIN Spacing sp ON sp.spacing_id = fs.spacing_fk`,
      )
      .all() as Row[];

    const profilesByBand = new Map<string, WwbProfile[]>();
    for (const r of profileRows) {
      const key = `${Number(r.band)}|${String(r.series)}`;
      const list = profilesByBand.get(key) ?? [];
      for (const { prefix, level } of LEVELS) {
        list.push({
          rfProfile: String(r.profile),
          level,
          isImdSource: Number(r.imd) === 1,
          guards: {
            spacingKHz: Number(r[`${prefix}_ch_to_ch`] ?? 0),
            im3TwoTxKHz: Number(r[`${prefix}_ch_to_2t3o`] ?? 0),
            im3ThreeTxKHz: Number(r[`${prefix}_ch_to_3t3o`] ?? 0),
            im5TwoTxKHz: Number(r[`${prefix}_ch_to_2t5o`] ?? 0),
          },
          unmodelledKHz: {
            twoTx7thKHz: Number(r[`${prefix}_ch_to_2t7o`] ?? 0),
            twoTx9thKHz: Number(r[`${prefix}_ch_to_2t9o`] ?? 0),
          },
        });
      }
      profilesByBand.set(key, list);
    }

    return bandRows.map((r): WwbBand => {
      const id = Number(r.id);
      const ranges = subRanges.get(id) ?? [];
      return {
        manufacturer: String(r.manufacturer),
        series: String(r.series),
        band: String(r.band),
        fromKHz: toKHz(Number(r.fs)),
        toKHz: toKHz(Number(r.fe)),
        stepKHz: Number(r.step),
        subRangesKHz: ranges.sort((a, b) => a[0] - b[0]),
        profiles: profilesByBand.get(`${id}|${String(r.series)}`) ?? [],
      };
    });
  } finally {
    db.close();
  }
}

function report(findings: readonly Finding[]): string {
  const lines: string[] = [];
  const byKind = (kind: Finding['kind']): Finding[] => findings.filter((f) => f.kind === kind);
  const matches = byKind('match');
  lines.push(`${matches.length} entrée(s) conformes à WWB, ${findings.length - matches.length} point(s) à regarder.`, '');
  for (const [kind, title] of [
    ['range-differs', 'Plages qui diffèrent'],
    ['step-differs', "Pas d'accord qui diffèrent"],
    ['sub-ranges', 'Bandes à trous'],
    ['unmodelled-order', 'Ordres que le moteur ne modélise pas'],
    ['not-in-wwb', 'Absents de WWB'],
  ] as const) {
    const group = byKind(kind);
    if (group.length === 0) continue;
    lines.push(`## ${title} (${group.length})`);
    for (const f of group) lines.push(`  ${f.entryId} : ${f.message}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const given = process.argv[2];
  const path = given ?? DEFAULT_PATHS[0];
  let bands: WwbBand[];
  try {
    bands = readWwbBands(path);
  } catch (error) {
    console.error(`Impossible de lire la base WWB « ${path} » : ${(error as Error).message}`);
    console.error('Chemins habituels :');
    for (const candidate of DEFAULT_PATHS) console.error(`  ${candidate}`);
    console.error("Passez le chemin en argument si WWB est installé ailleurs. Node 22.5 ou plus est nécessaire.");
    process.exit(1);
    return;
  }
  console.log(`Base WWB lue : ${bands.length} variantes de bande, ${new Set(bands.map((b) => `${b.manufacturer} ${b.series}`)).size} séries.\n`);
  console.log(report(compareToWwb(HARDWARE, bands)));
}

if (process.argv[1]?.endsWith('import-wwb.ts')) main();
