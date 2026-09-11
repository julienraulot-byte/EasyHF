import { festival, FR_BANDS, link as uhf, tntChannel } from './links.js';
import type { CheckInput, CoordinateInput, EngineLink } from '../../src/types.js';

export { FR_BANDS, tntChannel };

/**
 * Reference cases for the Phase 0 gate (see `docs/VALIDATION.md`).
 *
 * Each case is run by `validation.test.ts` and compared to a committed golden
 * file, so any change in engine behaviour shows up as a reviewable diff. The
 * `wwbReference` field is filled in by hand from a Wireless Workbench run; it
 * stays `undefined` until someone has actually done that run — an empty
 * reference is not the same as a passing comparison.
 */
export interface WwbReference {
  /**
   * Frequencies Wireless Workbench marks « Incompatible » in its analysis
   * results. WWB 7 gives a verdict per frequency, not the generating product,
   * so the comparison is on victims; `sourceLinkIds` is filled only when the
   * run exposed it.
   */
  incompatible: { victimLinkId: string; sourceLinkIds?: string[] }[];
  /** Frequencies WWB marks « Compatible ». Recorded, not asserted on. */
  compatible: string[];
  /** Compatibility profile applied in WWB, as its spacings, in kHz. */
  profile: { channelSpacing: number; im3TwoTx: number; im5TwoTx: number; im3ThreeTx: number };
  wwbVersion: string;
  /** ISO date of the WWB run. */
  capturedAt: string;
  /** Who ran it. */
  capturedBy: string;
}

/** ULXD4 G50, profile « EasyHF2 » — see docs/WWB-RELEVES.md. */
const WWB_RUN = {
  profile: { channelSpacing: 350, im3TwoTx: 200, im5TwoTx: 90, im3ThreeTx: 100 },
  wwbVersion: 'Wireless Workbench 7.8.3.18',
  capturedAt: '2026-09-11',
  capturedBy: 'Julien',
};

export type ValidationCase = {
  id: string;
  title: string;
  /** What this case is meant to pin down. */
  rationale: string;
  wwbReference?: WwbReference;
} & (
  | { mode: 'check'; input: CheckInput }
  | { mode: 'coordinate'; input: CoordinateInput }
);

function plan(entries: Record<string, number>) {
  return Object.entries(entries).map(([linkId, freqKHz]) => ({ linkId, freqKHz }));
}

const comb8 = Array.from({ length: 8 }, (_, i) => uhf(`PEIGNE${i + 1}`));

export const VALIDATION_CASES: ValidationCase[] = [
  {
    id: 'C01-paire-propre',
    title: 'Deux liaisons largement espacées',
    rationale: "Cas de contrôle : aucun produit ne doit être signalé sur une paire propre.",
    mode: 'check',
    input: {
      links: [uhf('HF01'), uhf('HF02')],
      plan: plan({ HF01: 500_000, HF02: 510_000 }),
      bands: FR_BANDS,
    },
    wwbReference: { ...WWB_RUN, incompatible: [], compatible: ['HF01', 'HF02'] },
  },
  {
    id: 'C02-im3-2tx-direct',
    title: 'Porteuse exactement sur 2·f1 − f2',
    rationale: "Le produit IM3 le plus fort du métier. 2 × 500,000 − 506,000 = 494,000 MHz.",
    mode: 'check',
    input: {
      links: [uhf('HF01'), uhf('HF02'), uhf('HF03')],
      plan: plan({ HF01: 500_000, HF02: 506_000, HF03: 494_000 }),
      bands: FR_BANDS,
    },
    wwbReference: {
      ...WWB_RUN,
      incompatible: [{ victimLinkId: 'HF02' }, { victimLinkId: 'HF03' }],
      compatible: ['HF01'],
    },
  },
  {
    id: 'C03-im3-2tx-limite',
    title: 'Porteuse exactement à la garde IM3',
    rationale: 'La garde est une inégalité stricte : 200 kHz du produit doit passer, 199 kHz non.',
    mode: 'check',
    input: {
      links: [uhf('HF01'), uhf('HF02'), uhf('HF03')],
      plan: plan({ HF01: 500_000, HF02: 506_000, HF03: 494_200 }),
      bands: FR_BANDS,
    },
    // WWB says compatible at exactly 200 kHz: its rule is strict too.
    wwbReference: { ...WWB_RUN, incompatible: [], compatible: ['HF01', 'HF02', 'HF03'] },
  },
  {
    id: 'C04-im3-3tx',
    title: 'Quadruplet vérifiant f1 + f4 = f2 + f3',
    rationale:
      "Produit à 3 émetteurs. La relation étant symétrique, les quatre porteuses sont victimes tour à tour.",
    mode: 'check',
    input: {
      links: [uhf('HF01'), uhf('HF02'), uhf('HF03'), uhf('HF04')],
      plan: plan({ HF01: 500_000, HF02: 505_300, HF03: 508_400, HF04: 513_700 }),
      bands: FR_BANDS,
    },
    // No 2-transmitter product within 2 MHz of any carrier: WWB's four verdicts
    // can only come from its 3-transmitter check.
    wwbReference: {
      ...WWB_RUN,
      incompatible: ['HF01', 'HF02', 'HF03', 'HF04'].map((victimLinkId) => ({ victimLinkId })),
      compatible: [],
    },
  },
  {
    id: 'C05-im5-2tx',
    title: 'Porteuse sur 3·f1 − 2·f2, hors de tout produit IM3',
    rationale:
      "Isole le 5e ordre : il doit être signalé en avertissement, pas en critique. Écarts ≥ 800 kHz : le profil ULX-D de WWB exige 700 kHz entre porteuses, et un écart plus court masquerait tout sous « spacing ».",
    mode: 'check',
    input: {
      links: [uhf('HF01'), uhf('HF02'), uhf('HF03')],
      // 3 × 500 000 − 2 × 500 800 = 498 400. Nearest IM3 product: 800 kHz away.
      plan: plan({ HF01: 500_000, HF02: 500_800, HF03: 498_400 }),
      bands: FR_BANDS,
    },
  },
  {
    id: 'C06-peigne-8',
    title: 'Huit porteuses sur un peigne à 800 kHz',
    rationale:
      "Le pire cas classique : un pas régulier fait retomber les produits sur les porteuses elles-mêmes. Pas de 800 kHz pour rester au-dessus des 700 kHz d'espacement du profil ULX-D de WWB.",
    mode: 'check',
    input: {
      links: comb8,
      plan: comb8.map((l, i) => ({ linkId: l.id, freqKHz: 500_000 + i * 800 })),
      bands: FR_BANDS,
    },
  },
  {
    id: 'C07-exclusions-tnt',
    title: 'Six liaisons à coordonner autour de six canaux TNT',
    rationale: "Vérifie que la coordination contourne les exclusions, garde de 250 kHz comprise.",
    mode: 'coordinate',
    input: {
      links: Array.from({ length: 6 }, (_, i) =>
        uhf(`HF${String(i + 1).padStart(2, '0')}`, { tuningRangeKHz: [510_000, 590_000] }),
      ),
      exclusions: [28, 29, 30, 31, 32, 33].map(tntChannel),
      bands: FR_BANDS,
    },
  },
  {
    id: 'C08-bande-interdite',
    title: 'Porteuse dans la bande 700 MHz',
    rationale:
      "Interdite aux PMSE depuis le 01/07/2019 (décision ARCEP 2016-0272) : doit être rejetée même sans autre liaison.",
    mode: 'check',
    input: {
      links: [uhf('HF01', { tuningRangeKHz: [470_000, 790_000] })],
      plan: plan({ HF01: 700_000 }),
      bands: FR_BANDS,
    },
  },
  {
    id: 'C09-deux-zones-spacing-only',
    title: 'Deux zones en « spacing-only » réutilisant le même produit IM3',
    rationale:
      "Sous « spacing-only », l'intermodulation inter-zones est ignorée mais l'espacement reste appliqué.",
    mode: 'check',
    input: {
      links: [
        uhf('A1', { zoneId: 'scene1' }),
        uhf('A2', { zoneId: 'scene1' }),
        uhf('B1', { zoneId: 'scene2' }),
      ],
      plan: plan({ A1: 500_000, A2: 506_000, B1: 494_000 }),
      zonePolicies: { scene1: 'spacing-only', scene2: 'spacing-only' },
      bands: FR_BANDS,
    },
  },
  {
    id: 'C10-festival-24',
    title: 'Coordination complète : 24 liaisons, 2 scènes, 3 familles de matériel',
    rationale:
      "Charge réaliste de bout en bout. Verrouille le plan produit, donc toute régression du moteur.",
    mode: 'coordinate',
    input: { links: festival(), bands: FR_BANDS },
  },
];
