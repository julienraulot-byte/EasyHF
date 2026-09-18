import { resolveConfig, resolveLinkGuards } from './config.js';
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
  Guards,
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

/** Whether a frequency falls in one of the link's tunable sub-ranges. */
export function fitsTunableRanges(link: EngineLink, freqKHz: number): boolean {
  const ranges = link.tunableRangesKHz;
  if (!ranges || ranges.length === 0) return true;
  return ranges.some(([from, to]) => freqKHz >= from && freqKHz <= to);
}

export function halfWidthKHz(link: EngineLink): number {
  return Math.ceil(link.channelWidthKHz / 2);
}

/**
 * Half-width a link presents to intermodulation: a narrowband carrier is a
 * point (WWB measures product distances centre to centre), a WMAS block is its
 * whole width.
 */
export function imHalfWidthKHz(link: EngineLink): number {
  return link.kind === 'wmas' ? halfWidthKHz(link) : 0;
}

/** Whether a link generates intermodulation products (D-026). */
export function generatesIm(link: EngineLink, config: EngineConfig): boolean {
  return link.kind !== 'wmas' || config.wmasAsImGenerator;
}

/**
 * Minimum carrier-to-carrier distance for a pair: the larger of the two
 * carriers' own spacings, widened by both channels.
 */
export function requiredSpacingKHz(
  a: EngineLink,
  b: EngineLink,
  spacingAKHz: number,
  spacingBKHz: number,
): number {
  const guard = Math.max(spacingAKHz, spacingBKHz);
  const widths = Math.ceil((a.channelWidthKHz + b.channelWidthKHz) / 2);
  // Between narrowband carriers the guard is centre to centre, as WWB measures
  // it. A wideband block keeps the guard clear *beyond* its edge (D-026).
  if (a.kind === 'wmas' || b.kind === 'wmas') return widths + guard;
  return Math.max(guard, widths);
}

/**
 * Minimum carrier-to-exclusion-edge distance, widened by the carrier itself.
 * A wideband block keeps the guard clear beyond its edge (D-026).
 */
export function requiredExclusionKHz(link: EngineLink, exclusionKHz: number): number {
  const half = halfWidthKHz(link);
  return link.kind === 'wmas' ? half + exclusionKHz : Math.max(exclusionKHz, half);
}

/**
 * Rejects a link the two halves of the engine would read differently.
 *
 * Both `checkPlan` and `coordinate` call this, and that is the point: a width
 * of zero gives a carrier no half-width to widen an exclusion by, so the mask
 * blocked an interval the checker measured as clear. One entry point refusing
 * the input while the other accepted it was a disagreement of its own.
 */
export function validateLinks(links: readonly EngineLink[]): void {
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.id)) throw new Error(`Liaison en double dans links : ${link.id}`);
    seen.add(link.id);
    if (!Number.isInteger(link.channelWidthKHz) || link.channelWidthKHz < 1) {
      throw new Error(
        `Liaison « ${link.id} » : largeur de canal invalide (${link.channelWidthKHz} kHz, entier ≥ 1 attendu)`,
      );
    }
  }
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

/**
 * A stable last resort for the sort. Two exclusions can overlap the same
 * carrier at the same edge and differ only by their label, so the label has to
 * take part; everything else is already separated by the fields above.
 */
function detailKey(detail: Violation['detail']): string {
  // Two exclusions can overlap the same carrier at the same edge and differ
  // only by their bounds, so the bounds take part too — the label alone left
  // two violations comparing equal, and a total order is what makes the report
  // independent of the order the caller listed things in (D-018).
  return detail.code === 'exclusion.too-close'
    ? `${detail.code}|${detail.label}|${detail.fromKHz}|${detail.toKHz}`
    : detail.code;
}

/** Element-wise, so that ids containing the join character cannot collide. */
function compareIdLists(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const order = compareIds(a[i] as string, b[i] as string);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      compareIds(a.victimLinkId, b.victimLinkId) ||
      a.offenderFreqKHz - b.offenderFreqKHz ||
      compareIdLists(a.sourceLinkIds, b.sourceLinkIds) ||
      compareIds(detailKey(a.detail), detailKey(b.detail)),
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
  validateLinks(input.links);
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
  const linkGuards = resolveLinkGuards(input.links, config.guards);
  const guardsById = new Map(input.links.map((link, i) => [link.id, linkGuards[i] as Guards]));

  const assigned: { link: EngineLink; freqKHz: number; guards: Guards }[] = [];
  const seen = new Set<string>();
  for (const entry of input.plan) {
    const link = byId.get(entry.linkId);
    if (!link) throw new Error(`Le plan référence une liaison inconnue : ${entry.linkId}`);
    if (seen.has(entry.linkId)) throw new Error(`Liaison assignée deux fois : ${entry.linkId}`);
    seen.add(entry.linkId);
    assigned.push({ link, freqKHz: entry.freqKHz, guards: guardsById.get(link.id) as Guards });
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


  // --- Hardware limits. A frequency the receiver cannot be tuned to is not a
  // plan, whatever the rest of the analysis says about it. Reached through
  // manual entry and plan imports, so it is checked rather than assumed.
  for (const { link, freqKHz } of assigned) {
    const [fromKHz, toKHz] = link.tuningRangeKHz;
    const outside = freqKHz < fromKHz || freqKHz > toKHz;
    const offGrid = !outside && (freqKHz - fromKHz) % link.stepKHz !== 0;
    const inHole = !outside && !offGrid && !fitsTunableRanges(link, freqKHz);
    if (!outside && !offGrid && !inHole) continue;
    violations.push({
      kind: 'out-of-tuning-range',
      severity: SEVERITY_BY_KIND['out-of-tuning-range'],
      victimLinkId: link.id,
      victimFreqKHz: freqKHz,
      sourceLinkIds: [],
      offenderFreqKHz: freqKHz,
      requiredKHz: link.stepKHz,
      actualKHz: 0,
      detail: outside
        ? { code: 'tuning.outside', fromKHz, toKHz }
        : inHole
          ? { code: 'tuning.hole', tunableRangesKHz: link.tunableRangesKHz ?? [] }
          : { code: 'tuning.off-grid', fromKHz, stepKHz: link.stepKHz },
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
        detail: { code: 'band.not-allowed', channelWidthKHz: link.channelWidthKHz },
      });
    }
  }

  // --- Exclusions (TNT, scans, manual, regulatory).
  for (const { link, freqKHz, guards } of assigned) {
    const required = requiredExclusionKHz(link, guards.exclusionKHz);
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
        detail: {
          code: 'exclusion.too-close',
          label: exclusion.label,
          fromKHz: exclusion.fromKHz,
          toKHz: exclusion.toKHz,
        },
      });
    }
  }

  // --- Carrier spacing.
  const spacingRequired = (i: number, j: number): number => {
    const a = assigned[i] as (typeof assigned)[number];
    const b = assigned[j] as (typeof assigned)[number];
    return requiredSpacingKHz(a.link, b.link, a.guards.spacingKHz, b.guards.spacingKHz);
  };
  for (let i = 0; i < assigned.length; i += 1) {
    const a = assigned[i] as (typeof assigned)[number];
    for (let j = i + 1; j < assigned.length; j += 1) {
      const b = assigned[j] as (typeof assigned)[number];
      if (relationBetween(a.link.zoneId, b.link.zoneId, input.zonePolicies) === 'none') continue;
      const required = spacingRequired(i, j);
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
        detail: { code: 'spacing.too-close' },
      });
    }
  }

  // --- Intermodulation.
  const freqs = assigned.map((entry) => entry.freqKHz);
  forEachImHit(
    freqs,
    {
      guards: assigned.map((entry) => entry.guards),
      windowFactor: MARGIN_WINDOW_FACTOR,
      enableIm3ThreeTx: config.enableIm3ThreeTx,
      enableIm5TwoTx: config.enableIm5TwoTx,
      relation: (a, b) =>
        relationBetween(
          (assigned[a] as { link: EngineLink }).link.zoneId,
          (assigned[b] as { link: EngineLink }).link.zoneId,
          input.zonePolicies,
        ),
      halfWidthKHz: assigned.map((entry) => imHalfWidthKHz(entry.link)),
      generates: assigned.map((entry) => generatesIm(entry.link, config)),
    },
    (hit) => {
      const guard = hit.requiredKHz;
      const key = MARGIN_KEY_BY_KIND[hit.kind];
      margins[key] = tighten(margins[key], hit.distanceKHz);
      if (hit.distanceKHz >= guard) return;
      const victim = assigned[hit.victimIndex] as { link: EngineLink; freqKHz: number };
      const sourceLinkIds = hit.sourceIndices.map(
        (index) => (assigned[index] as { link: EngineLink }).link.id,
      );
      violations.push({
        kind: hit.kind,
        severity: SEVERITY_BY_KIND[hit.kind],
        victimLinkId: victim.link.id,
        victimFreqKHz: victim.freqKHz,
        sourceLinkIds,
        offenderFreqKHz: hit.productKHz,
        requiredKHz: guard,
        actualKHz: hit.distanceKHz,
        detail: {
          code: 'im.too-close',
          coefficients: hit.coefficients,
          ...(victim.link.kind === 'wmas' ? { victimBlockHalfWidthKHz: halfWidthKHz(victim.link) } : {}),
        },
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
