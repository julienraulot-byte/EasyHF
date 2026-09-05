import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EngineBand, EngineLink } from '../../src/types.js';

/** A generic UHF handheld: 470–694 MHz tunable, 25 kHz grid, 200 kHz channel. */
export function link(id: string, overrides: Partial<EngineLink> = {}): EngineLink {
  return {
    id,
    zoneId: '',
    tuningRangeKHz: [470_000, 694_000],
    stepKHz: 25,
    channelWidthKHz: 200,
    ...overrides,
  };
}

/** The French band plan, read from the one file the product ships. */
export const FR_BANDS: EngineBand[] = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../data/bands/fr.json', import.meta.url)), 'utf8'),
  ) as { bands: EngineBand[] }
).bands;

/** UHF TNT channel N: 8 MHz wide, channel 21 starting at 470 MHz. */
export function tntChannel(channel: number) {
  const fromKHz = 470_000 + (channel - 21) * 8_000;
  return {
    fromKHz,
    toKHz: fromKHz + 8_000,
    source: 'tnt-anfr' as const,
    label: `Canal TNT ${channel}`,
  };
}

/** 24 links, 2 stages, 3 hardware families — a realistic festival load. */
export function festival(): EngineLink[] {
  return [
    ...Array.from({ length: 12 }, (_, i) =>
      link(`SC1-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene1',
        tuningRangeKHz: [534_000, 598_000],
      }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      link(`SC2-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene2',
        tuningRangeKHz: [606_000, 678_000],
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      link(`IEM-${String(i + 1).padStart(2, '0')}`, {
        zoneId: 'scene1',
        tuningRangeKHz: [606_000, 630_000],
        stepKHz: 125,
        channelWidthKHz: 300,
      }),
    ),
  ];
}
