/**
 * Validates the hardware data files against the JSON Schema and against the
 * rules the schema cannot express. Exit code 1 on any finding, so CI stops.
 *
 * Run: `pnpm --filter @easyhf/hardware-db validate`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exit } from 'node:process';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { resolveConfig } from '@easyhf/engine';
import { HARDWARE } from './index.js';
import type { HardwareEntry } from './types.js';

export function findings(entries: readonly HardwareEntry[]): string[] {
  const schema = JSON.parse(
    readFileSync(fileURLToPath(new URL('../schema/hardware.schema.json', import.meta.url)), 'utf8'),
  ) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const label = entry.id ?? '(sans id)';
    if (!validate(entry)) {
      for (const error of validate.errors ?? []) {
        out.push(`${label} : ${error.instancePath || '/'} ${error.message ?? ''}`.trim());
      }
      continue;
    }
    if (seen.has(entry.id)) out.push(`${label} : identifiant en double`);
    seen.add(entry.id);

    const [from, to] = entry.tuningRangeKHz;
    if (to <= from) out.push(`${label} : plage d'accord inversée ou vide (${from}–${to} kHz)`);
    if (from < 100_000 || to > 2_000_000) {
      out.push(`${label} : plage ${from}–${to} kHz hors de tout usage PMSE plausible (100 MHz – 2 GHz)`);
    }
    // Narrowband links top out around 200–300 kHz; a WMAS entry describes a
    // whole multichannel block (Spectera: 6 or 8 MHz), modelled as one carrier.
    const maxWidth = entry.type === 'wmas' ? 10_000 : 2_000;
    if (entry.channelWidthKHz > maxWidth) {
      out.push(`${label} : largeur de canal ${entry.channelWidthKHz} kHz invraisemblable pour le type ${entry.type}`);
    }
    if (entry.stepKHz > 1_000) out.push(`${label} : pas d'accord ${entry.stepKHz} kHz invraisemblable`);
    if (entry.stepKHz > 0 && (to - from) % entry.stepKHz !== 0) {
      out.push(`${label} : la borne haute ${to} kHz n'est pas sur la grille de ${entry.stepKHz} kHz depuis ${from}`);
    }
    if (entry.verified && !entry.verifiedAt) out.push(`${label} : verified: true sans verifiedAt`);
    if (!entry.verified && entry.verifiedAt) out.push(`${label} : verifiedAt sans verified: true`);
    if (entry.guards) {
      try {
        resolveConfig({ guards: entry.guards });
      } catch (error) {
        out.push(`${label} : ${(error as Error).message}`);
      }
    }
  }
  return out;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const problems = findings(HARDWARE);
  if (problems.length === 0) {
    console.log(`Base matériel valide : ${HARDWARE.length} entrées.`);
  } else {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(`${problems.length} problème(s).`);
    exit(1);
  }
}
