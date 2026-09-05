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

/** The French PMSE bands, trimmed to what the engine reads. */
export const FR_BANDS: EngineBand[] = [
  { fromKHz: 174_000, toKHz: 223_000, status: 'free', label: 'VHF 174–223' },
  { fromKHz: 470_000, toKHz: 694_000, status: 'free', label: 'UHF 470–694' },
  { fromKHz: 694_000, toKHz: 790_000, status: 'forbidden', label: 'Bande 700 (interdite PMSE)' },
  { fromKHz: 823_000, toKHz: 832_000, status: 'free', label: '823–832' },
  { fromKHz: 1_240_000, toKHz: 1_260_000, status: 'temporary', label: '1,2 GHz' },
  { fromKHz: 1_785_000, toKHz: 1_800_000, status: 'free', label: '1785–1800' },
];

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
