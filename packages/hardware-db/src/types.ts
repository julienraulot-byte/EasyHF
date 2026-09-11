import type { Guards } from '@easyhf/engine';

export type HardwareType = 'handheld' | 'bodypack' | 'iem' | 'intercom' | 'receiver' | 'wmas';

/** One tunable model in one band variant, as sold. See `schema/hardware.schema.json`. */
export interface HardwareEntry {
  id: string;
  brand: string;
  series: string;
  model: string;
  bandVariant: string;
  type: HardwareType;
  tuningRangeKHz: [number, number];
  stepKHz: number;
  channelWidthKHz: number;
  guards?: Partial<Guards>;
  notes?: string;
  source: string;
  verified: boolean;
  verifiedAt?: string;
}
