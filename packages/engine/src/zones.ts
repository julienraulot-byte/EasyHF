import type { InterZonePolicy, ZonePolicies } from './types.js';

/**
 * How two carriers constrain each other.
 *  - `full`    — carrier spacing *and* intermodulation.
 *  - `spacing` — carrier spacing only.
 *  - `none`    — no constraint at all.
 */
export type Relation = 'full' | 'spacing' | 'none';

const CONSTRAINT_RANK: Record<InterZonePolicy, number> = {
  'full-intermod': 2,
  'spacing-only': 1,
  isolated: 0,
};

const RELATION_BY_RANK: readonly Relation[] = ['none', 'spacing', 'full'];

/** Numeric form of a relation, for the matrices the assignment search keeps. */
export const RELATION_RANK: Record<Relation, 0 | 1 | 2> = { none: 0, spacing: 1, full: 2 };

/**
 * Two carriers in the same zone always constrain each other fully.
 *
 * Across zones the two zones may disagree — one declared `isolated`, the other
 * `full-intermod`. EasyHF resolves that by taking the *more* constraining of
 * the two: a plan is never silently loosened because one zone was optimistic.
 * Zones with no declared policy default to `spacing-only`, which is what
 * Wireless Workbench does between RF zones (DECISIONS.md, D-010).
 */
export function relationBetween(
  zoneA: string,
  zoneB: string,
  policies: ZonePolicies | undefined,
): Relation {
  if (zoneA === zoneB) return 'full';
  const a = policies?.[zoneA] ?? 'spacing-only';
  const b = policies?.[zoneB] ?? 'spacing-only';
  const rank = Math.max(CONSTRAINT_RANK[a], CONSTRAINT_RANK[b]);
  return RELATION_BY_RANK[rank] as Relation;
}
