import { resolveConfig } from './config.js';
import { compareIds } from './order.js';
import { forEachImHit, type ImKind } from './intermod.js';
import { relationBetween } from './zones.js';
import { ENGINE_VERSION } from './version.js';
import type {
  CheckInput,
  CheckResult,
  EngineBand,
  EngineConfig,
  EngineExclusion,
  EngineLink,
  Margins,
  Severity,
  Violation,
  ViolationKind,
} from './types.js';

/**
 * Clearances are searched up to this multiple of the guard so that a plan can
 * report *how much* room it has, not just whether it passed. Beyond it, the
 * corresponding margin is reported as `null` — "nothing near enough to matter".
 */
export const MARGIN_WINDOW_FACTOR = 4;

const KIND_RANK: Record<ViolationKind, number> = {
  'out-of-tuning-range': 0,
  'out-of-band': 1,
  exclusion: 2,
  spacing: 3,
  'im3-2tx': 4,
  'im3-3tx': 5,
  'im5-2tx': 6,
};

const SEVERITY_BY_KIND: Record<ViolationKind, Severity> = {
  'out-of-tuning-range': 'critical',
  'out-of-band': 'critical',
  exclusion: 'critical',
  spacing: 'critical',
  'im3-2tx': 'critical',
  'im3-3tx': 'critical',
  'im5-2tx': 'warning',
};

const MARGIN_KEY_BY_KIND: Record<ImKind, 'im3TwoTxKHz' | 'im3ThreeTxKHz' | 'im5TwoTxKHz'> = {
  'im3-2tx': 'im3TwoTxKHz',
  'im3-3tx': 'im3ThreeTxKHz',
  'im5-2tx': 'im5TwoTxKHz',
};

const IM_LABEL: Record<ImKind, string> = {
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

export function halfWidthKHz(link: EngineLink): number {
  return Math.ceil(link.channelWidthKHz / 2);
}

/** Minimum carrier-to-carrier distance for a pair, widened by both channels. */
export function requiredSpacingKHz(a: EngineLink, b: EngineLink, spacingKHz: number): number {
  return Math.max(spacingKHz, Math.ceil((a.channelWidthKHz + b.channelWidthKHz) / 2));
}

/** Minimum carrier-to-exclusion-edge distance, widened by the carrier itself. */
export function requiredExclusionKHz(link: EngineLink, exclusionKHz: number): number {
  return Math.max(exclusionKHz, halfWidthKHz(link));
}

/** Rejects an exclusion the two halves of the engine would read differently. */
export function validExclusions(
  exclusions: readonly EngineExclusion[] | undefined,
): readonly EngineExclusion[] {
  for (const exclusion of exclusions ?? []) {
    if (exclusion.toKHz < exclusion.fromKHz) {
      throw new Error(
        `Exclusion « ${exclusion.label} » inversée : ${exclusion.fromKHz}–${exclusion.toKHz} kHz`,
      );
    }
  }
  return exclusions ?? [];
}

/** Distance from a point to a closed interval; 0 when inside. */
export function distanceToInterval(freq: number, from: number, to: number): number {
  if (freq < from) return from - freq;
  if (freq > to) return freq - to;
  return 0;
}

/**
 * The spectrum a carrier may occupy: allowed bands, with contiguous or
 * overlapping ones merged. A band plan may split one physical band into two
 * entries (different notes, different power limits) and a carrier sitting on
 * that seam is not out of band.
 */
export function allowedSpans(
  bands: readonly EngineBand[],
  allowTemporary: boolean,
): readonly (readonly [number, number])[] {
  const allowed = bands
    .filter((band) => band.status === 'free' || (band.status === 'temporary' && allowTemporary))
    .map((band) => [band.fromKHz, band.toKHz] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [from, to] of allowed) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** Whether a carrier fits, channel width included, in the allowed spectrum. */
export function fitsAllowedSpan(
  freq: number,
  half: number,
  spans: readonly (readonly [number, number])[],
): boolean {
  return spans.some(([from, to]) => freq - half >= from && freq + half <= to);
}

function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      compareIds(a.victimLinkId, b.victimLinkId) ||
      a.offenderFreqKHz - b.offenderFreqKHz ||
      compareIds(a.sourceLinkIds.join('|'), b.sourceLinkIds.join('|')) ||
      // Two exclusions can overlap the same carrier at the same edge; only the
      // message tells them apart, and something has to.
      compareIds(a.message, b.message),
  );
}

function tighten(current: number | null, candidate: number): number | null {
  return current === null || candidate < current ? candidate : current;
}

/**
 * Checks a complete or partial plan against every constraint family and reports
 * each breach individually.
 *
 * Over-reporting is a nuisance; under-reporting puts a bad plan on a stage. So
 * where the two trade off, this function over-reports.
 */
export function checkPlan(input: CheckInput): CheckResult {
  const config: EngineConfig = resolveConfig(input.config);
  const bands = input.bands ?? [];
  // Normalised so that the same set of exclusions, however it was ordered by
  // the caller, yields the same report.
  const exclusions = [...validExclusions(input.exclusions)].sort(
    (a, b) =>
      a.fromKHz - b.fromKHz ||
      a.toKHz - b.toKHz ||
      compareIds(a.source, b.source) ||
      compareIds(a.label, b.label),
  );

  const byId = new Map<string, EngineLink>();
  for (const link of input.links) {
    if (byId.has(link.id)) throw new Error(`Liaison en double dans links : ${link.id}`);
    byId.set(link.id, link);
  }

  const assigned: { link: EngineLink; freqKHz: number }[] = [];
  const seen = new Set<string>();
  for (const entry of input.plan) {
    const link = byId.get(entry.linkId);
    if (!link) throw new Error(`Le plan référence une liaison inconnue : ${entry.linkId}`);
    if (seen.has(entry.linkId)) throw new Error(`Liaison assignée deux fois : ${entry.linkId}`);
    seen.add(entry.linkId);
    assigned.push({ link, freqKHz: entry.freqKHz });
  }
  // Stable, frequency-ordered evaluation so that identical inputs given in a
  // different order produce byte-identical output.
  assigned.sort((a, b) => a.freqKHz - b.freqKHz || compareIds(a.link.id, b.link.id));

  const violations: Violation[] = [];
  const margins: Margins = {
    im3TwoTxKHz: null,
    im3ThreeTxKHz: null,
    im5TwoTxKHz: null,
    spacingKHz: null,
    exclusionKHz: null,
  };
  const guardFor: Record<ImKind, number> = {
    'im3-2tx': config.guards.im3TwoTxKHz,
    'im3-3tx': config.guards.im3ThreeTxKHz,
    'im5-2tx': config.guards.im5TwoTxKHz,
  };

  // --- Hardware limits. A frequency the receiver cannot be tuned to is not a
  // plan, whatever the rest of the analysis says about it. Reached through
  // manual entry and plan imports, so it is checked rather than assumed.
  for (const { link, freqKHz } of assigned) {
    const [fromKHz, toKHz] = link.tuningRangeKHz;
    const outside = freqKHz < fromKHz || freqKHz > toKHz;
    const offGrid = !outside && (freqKHz - fromKHz) % link.stepKHz !== 0;
    if (!outside && !offGrid) continue;
    violations.push({
      kind: 'out-of-tuning-range',
      severity: SEVERITY_BY_KIND['out-of-tuning-range'],
      victimLinkId: link.id,
      victimFreqKHz: freqKHz,
      sourceLinkIds: [],
      offenderFreqKHz: freqKHz,
      requiredKHz: link.stepKHz,
      actualKHz: 0,
      message: outside
        ? `${mhz(freqKHz)} MHz est hors de la plage d'accord de ${link.id} (${mhz(fromKHz)}–${mhz(toKHz)} MHz).`
        : `${mhz(freqKHz)} MHz n'est pas sur la grille d'accord de ${link.id} (pas de ${link.stepKHz} kHz depuis ${mhz(fromKHz)} MHz).`,
    });
  }

  // --- Regulatory bands.
  if (bands.length > 0) {
    const spans = allowedSpans(bands, config.allowTemporaryBands);
    for (const { link, freqKHz } of assigned) {
      const half = halfWidthKHz(link);
      if (fitsAllowedSpan(freqKHz, half, spans)) continue;
      violations.push({
        kind: 'out-of-band',
        severity: SEVERITY_BY_KIND['out-of-band'],
        victimLinkId: link.id,
        victimFreqKHz: freqKHz,
        sourceLinkIds: [],
        offenderFreqKHz: freqKHz,
        requiredKHz: half,
        actualKHz: 0,
        message: `${mhz(freqKHz)} MHz n'est dans aucune bande PMSE autorisée (largeur de canal ${link.channelWidthKHz} kHz incluse).`,
      });
    }
  }

  // --- Exclusions (TNT, scans, manual, regulatory).
  for (const { link, freqKHz } of assigned) {
    const required = requiredExclusionKHz(link, config.guards.exclusionKHz);
    for (const exclusion of exclusions) {
      const actual = distanceToInterval(freqKHz, exclusion.fromKHz, exclusion.toKHz);
      if (actual <= required * MARGIN_WINDOW_FACTOR) {
        margins.exclusionKHz = tighten(margins.exclusionKHz, actual);
      }
      if (actual >= required) continue;
      const nearestEdge =
        freqKHz < exclusion.fromKHz
          ? exclusion.fromKHz
          : freqKHz > exclusion.toKHz
            ? exclusion.toKHz
            : freqKHz;
      violations.push({
        kind: 'exclusion',
        severity: SEVERITY_BY_KIND.exclusion,
        victimLinkId: link.id,
        victimFreqKHz: freqKHz,
        sourceLinkIds: [],
        offenderFreqKHz: nearestEdge,
        requiredKHz: required,
        actualKHz: actual,
        message: `${mhz(freqKHz)} MHz est à ${actual} kHz de l'exclusion « ${exclusion.label} » (${mhz(exclusion.fromKHz)}–${mhz(exclusion.toKHz)} MHz), minimum requis ${required} kHz.`,
      });
    }
  }

  // --- Carrier spacing.
  for (let i = 0; i < assigned.length; i += 1) {
    const a = assigned[i] as { link: EngineLink; freqKHz: number };
    for (let j = i + 1; j < assigned.length; j += 1) {
      const b = assigned[j] as { link: EngineLink; freqKHz: number };
      if (relationBetween(a.link.zoneId, b.link.zoneId, input.zonePolicies) === 'none') continue;
      const required = requiredSpacingKHz(a.link, b.link, config.guards.spacingKHz);
      const actual = Math.abs(a.freqKHz - b.freqKHz);
      if (actual <= required * MARGIN_WINDOW_FACTOR) {
        margins.spacingKHz = tighten(margins.spacingKHz, actual);
      }
      if (actual >= required) continue;
      violations.push({
        kind: 'spacing',
        severity: SEVERITY_BY_KIND.spacing,
        victimLinkId: a.link.id,
        victimFreqKHz: a.freqKHz,
        sourceLinkIds: [b.link.id],
        offenderFreqKHz: b.freqKHz,
        requiredKHz: required,
        actualKHz: actual,
        message: `${a.link.id} et ${b.link.id} ne sont séparées que de ${actual} kHz, minimum requis ${required} kHz.`,
      });
    }
  }

  // --- Intermodulation.
  const freqs = assigned.map((entry) => entry.freqKHz);
  forEachImHit(
    freqs,
    {
      im3TwoTxKHz: config.guards.im3TwoTxKHz * MARGIN_WINDOW_FACTOR,
      im3ThreeTxKHz: config.guards.im3ThreeTxKHz * MARGIN_WINDOW_FACTOR,
      im5TwoTxKHz: config.guards.im5TwoTxKHz * MARGIN_WINDOW_FACTOR,
      enableIm3ThreeTx: config.enableIm3ThreeTx,
      enableIm5TwoTx: config.enableIm5TwoTx,
      relation: (a, b) =>
        relationBetween(
          (assigned[a] as { link: EngineLink }).link.zoneId,
          (assigned[b] as { link: EngineLink }).link.zoneId,
          input.zonePolicies,
        ),
    },
    (hit) => {
      const guard = guardFor[hit.kind];
      const key = MARGIN_KEY_BY_KIND[hit.kind];
      margins[key] = tighten(margins[key], hit.distanceKHz);
      if (hit.distanceKHz >= guard) return;
      const victim = assigned[hit.victimIndex] as { link: EngineLink; freqKHz: number };
      const sourceLinkIds = hit.sourceIndices.map(
        (index) => (assigned[index] as { link: EngineLink }).link.id,
      );
      const expression = productExpression(sourceLinkIds, hit.coefficients);
      violations.push({
        kind: hit.kind,
        severity: SEVERITY_BY_KIND[hit.kind],
        victimLinkId: victim.link.id,
        victimFreqKHz: victim.freqKHz,
        sourceLinkIds,
        offenderFreqKHz: hit.productKHz,
        requiredKHz: guard,
        actualKHz: hit.distanceKHz,
        message: `${IM_LABEL[hit.kind]} ${expression} tombe à ${mhz(hit.productKHz)} MHz, soit ${hit.distanceKHz} kHz de ${victim.link.id} (${mhz(victim.freqKHz)} MHz), minimum requis ${guard} kHz.`,
      });
    },
  );

  sortViolations(violations);
  return {
    ok: !violations.some((v) => v.severity === 'critical'),
    violations,
    margins,
    engineVersion: ENGINE_VERSION,
  };
}
