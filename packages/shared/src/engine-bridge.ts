import type {
  CoordinateInput,
  CoordinationResult,
  EngineLink,
  InterZonePolicy,
} from '@easyhf/engine';
import type { BandPlan, Project } from './domain.js';

/**
 * The part of a hardware entry the engine needs. `@easyhf/hardware-db` (phase 1)
 * provides the full record; anything that can answer this shape will do.
 */
export interface HardwareProfile {
  tuningRangeKHz: readonly [number, number];
  stepKHz: number;
  channelWidthKHz: number;
}

export class UnknownHardwareError extends Error {
  constructor(readonly linkId: string, readonly hardwareRef: string) {
    super(`Liaison « ${linkId} » : matériel « ${hardwareRef} » introuvable dans la base.`);
    this.name = 'UnknownHardwareError';
  }
}

/**
 * Flattens a project into the engine's input.
 *
 * The engine knows nothing about projects, zones or hardware records — this is
 * the one place the two vocabularies meet, so a change to either stays local.
 */
export function toCoordinateInput(
  project: Project,
  hardware: (ref: string) => HardwareProfile | undefined,
  bandPlan?: BandPlan,
): CoordinateInput {
  const links: EngineLink[] = [];
  const zonePolicies: Record<string, InterZonePolicy> = {};

  for (const zone of project.zones) {
    zonePolicies[zone.id] = zone.interZonePolicy;
    for (const link of zone.links) {
      const profile = hardware(link.hardwareRef);
      if (!profile) throw new UnknownHardwareError(link.id, link.hardwareRef);
      links.push({
        id: link.id,
        zoneId: zone.id,
        tuningRangeKHz: profile.tuningRangeKHz,
        stepKHz: profile.stepKHz,
        channelWidthKHz: profile.channelWidthKHz,
        ...(link.locked && link.assignedFreqKHz !== undefined
          ? { lockedFreqKHz: link.assignedFreqKHz }
          : {}),
      });
    }
  }

  return {
    links,
    exclusions: project.exclusions,
    zonePolicies,
    config: project.engineConfig,
    ...(bandPlan ? { bands: bandPlan.bands } : {}),
  };
}

/**
 * Writes a coordination result back into a project.
 *
 * Locked links keep their frequency by construction — the engine returns it
 * unchanged — and links the engine could not place have theirs cleared, so the
 * UI never shows a stale frequency as if it were part of the current plan.
 */
export function applyPlan(project: Project, result: CoordinationResult, now: string): Project {
  const assigned = new Map(result.assignments.map((entry) => [entry.linkId, entry.freqKHz]));
  return {
    ...project,
    zones: project.zones.map((zone) => ({
      ...zone,
      links: zone.links.map((link) => {
        const freqKHz = assigned.get(link.id);
        const { assignedFreqKHz: _dropped, ...rest } = link;
        return freqKHz === undefined ? rest : { ...rest, assignedFreqKHz: freqKHz };
      }),
    })),
    engineVersion: result.engineVersion,
    updatedAt: now,
  };
}
