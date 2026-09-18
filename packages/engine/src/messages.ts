/**
 * French rendering of a violation.
 *
 * The engine itself emits no prose: `Violation.detail` carries a code and the
 * values a sentence needs, and formatting lives here (D-036). That keeps the
 * golden files free of language, so the Kotlin port has to reproduce numbers
 * rather than characters, and it is what will let the interface speak anything
 * but French when the product leaves the country (D-031).
 */

import type { Violation, ViolationKind } from './types.js';

const IM_LABEL: Record<Extract<ViolationKind, `im${string}`>, string> = {
  'im3-2tx': 'IM3 (2 émetteurs)',
  'im3-3tx': 'IM3 (3 émetteurs)',
  'im5-2tx': 'IM5 (2 émetteurs)',
};

function mhz(khz: number): string {
  return (khz / 1000).toFixed(3);
}

/**
 * Renders a product as the arithmetic a coordinator can check by hand, e.g.
 * `HF03 + HF02 − HF01` or `2×HF01 − HF04`.
 */
function productExpression(linkIds: readonly string[], coefficients: readonly number[]): string {
  return linkIds
    .map((id, index) => {
      const coefficient = coefficients[index] as number;
      const magnitude = Math.abs(coefficient);
      const term = magnitude === 1 ? id : `${magnitude}×${id}`;
      if (index === 0) return coefficient < 0 ? `−${term}` : term;
      return `${coefficient < 0 ? ' − ' : ' + '}${term}`;
    })
    .join('');
}

export function formatViolation(violation: Violation): string {
  const { detail, victimLinkId: id, victimFreqKHz: freq, requiredKHz, actualKHz } = violation;
  switch (detail.code) {
    case 'tuning.outside':
      return `${mhz(freq)} MHz est hors de la plage d'accord de ${id} (${mhz(detail.fromKHz)}–${mhz(detail.toKHz)} MHz).`;
    case 'tuning.off-grid':
      return `${mhz(freq)} MHz n'est pas sur la grille d'accord de ${id} (pas de ${detail.stepKHz} kHz depuis ${mhz(detail.fromKHz)} MHz).`;
    case 'tuning.hole':
      return `${mhz(freq)} MHz tombe dans un trou de la bande de ${id}, qui n'accorde que ${detail.tunableRangesKHz
        .map(([a, b]) => `${mhz(a)}–${mhz(b)}`)
        .join(', ')} MHz.`;
    case 'band.not-allowed':
      return `${id} à ${mhz(freq)} MHz n'est dans aucune bande PMSE autorisée (largeur de canal ${detail.channelWidthKHz} kHz incluse).`;
    case 'exclusion.too-close':
      return `${id} à ${mhz(freq)} MHz est à ${actualKHz} kHz de l'exclusion « ${detail.label} » (${mhz(detail.fromKHz)}–${mhz(detail.toKHz)} MHz), minimum requis ${requiredKHz} kHz.`;
    case 'spacing.too-close':
      return `${id} (${mhz(freq)} MHz) et ${violation.sourceLinkIds[0] ?? '?'} (${mhz(violation.offenderFreqKHz)} MHz) sont à ${actualKHz} kHz, minimum requis ${requiredKHz} kHz.`;
    case 'im.too-close': {
      const expression = productExpression(violation.sourceLinkIds, detail.coefficients);
      const label = IM_LABEL[violation.kind as keyof typeof IM_LABEL];
      const target =
        detail.victimBlockHalfWidthKHz === undefined
          ? `${id} (${mhz(freq)} MHz)`
          : `du bord du bloc ${id} (${mhz(freq)} MHz ± ${detail.victimBlockHalfWidthKHz} kHz)`;
      const preposition = detail.victimBlockHalfWidthKHz === undefined ? 'de ' : '';
      return `${label} ${expression} tombe à ${mhz(violation.offenderFreqKHz)} MHz, soit ${actualKHz} kHz ${preposition}${target}, minimum requis ${requiredKHz} kHz.`;
    }
  }
}
