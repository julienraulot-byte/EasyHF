import type { EngineLink } from '../../src/types.js';

/** A generic UHF handheld: 470–694 MHz tunable, 25 kHz grid, 200 kHz channel. */
export function link(id: string, overrides: Partial<EngineLink> = {}): EngineLink {
  return {
    id,
    zoneId: '',
    tuningRangeKHz: [470000, 694000],
    stepKHz: 25,
    channelWidthKHz: 200,
    ...overrides,
  };
}

/** `count` links tuned on a regular comb — the classic intermodulation worst case. */
export function comb(count: number, startKHz: number, stepKHz: number) {
  const links = Array.from({ length: count }, (_, i) => link(`HF${String(i + 1).padStart(2, '0')}`));
  const plan = links.map((l, i) => ({ linkId: l.id, freqKHz: startKHz + i * stepKHz }));
  return { links, plan };
}

/** UHF TNT channel N (8 MHz, channel 21 starts at 470 MHz). */
export function tntChannel(channel: number) {
  const fromKHz = 470000 + (channel - 21) * 8000;
  return {
    fromKHz,
    toKHz: fromKHz + 8000,
    source: 'tnt-anfr' as const,
    label: `Canal TNT ${channel}`,
  };
}
