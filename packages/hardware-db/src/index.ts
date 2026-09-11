import type { HardwareProfile } from '@easyhf/shared';
import others from '../data/others.json' with { type: 'json' };
import sennheiser from '../data/sennheiser.json' with { type: 'json' };
import shure from '../data/shure.json' with { type: 'json' };
import type { HardwareEntry } from './types.js';

export type { HardwareEntry, HardwareType } from './types.js';

/**
 * Every entry the product ships, in file order. The data files are the source
 * of truth and are validated by `pnpm --filter @easyhf/hardware-db validate`
 * (also in CI); this module only reads them.
 */
export const HARDWARE: readonly HardwareEntry[] = [
  ...(shure as HardwareEntry[]),
  ...(sennheiser as HardwareEntry[]),
  ...(others as HardwareEntry[]),
];

const byId = new Map(HARDWARE.map((entry) => [entry.id, entry]));

export function findHardware(id: string): HardwareEntry | undefined {
  return byId.get(id);
}

/** What the engine needs from an entry — the shape `@easyhf/shared` bridges on. */
export function hardwareProfile(entry: HardwareEntry): HardwareProfile {
  return {
    tuningRangeKHz: entry.tuningRangeKHz,
    stepKHz: entry.stepKHz,
    channelWidthKHz: entry.channelWidthKHz,
    ...(entry.guards ? { guards: entry.guards } : {}),
  };
}

/** Lookup in the shape `toCoordinateInput` takes. */
export function hardwareProfileById(id: string): HardwareProfile | undefined {
  const entry = byId.get(id);
  return entry ? hardwareProfile(entry) : undefined;
}

/**
 * Case-insensitive search over brand, series, model and band, every word of
 * the query having to match somewhere. Meant for a picker, not for scale.
 */
export function searchHardware(query: string): HardwareEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...HARDWARE];
  return HARDWARE.filter((entry) => {
    const haystack = `${entry.brand} ${entry.series} ${entry.model} ${entry.bandVariant}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
