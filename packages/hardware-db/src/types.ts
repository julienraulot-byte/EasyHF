import type { Guards } from '@easyhf/engine';

export type HardwareType = 'handheld' | 'bodypack' | 'iem' | 'intercom' | 'receiver' | 'wmas';

/**
 * How much the figures of an entry can be trusted.
 *
 * `verified` — every figure checked against the source, on a given date.
 * `manufacturer` — read off manufacturer documentation, not yet checked.
 * `user` — entered by a user on their own device. Never shipped here: the
 *   validator refuses it, so nothing anyone types can travel to another user.
 */
export type HardwareProvenance = 'verified' | 'manufacturer' | 'user';

/** One tunable model in one band variant, as sold. See `schema/hardware.schema.json`. */
export interface HardwareEntry {
  id: string;
  brand: string;
  series: string;
  model: string;
  bandVariant: string;
  type: HardwareType;
  tuningRangeKHz: [number, number];
  /** Tunable sub-ranges when the band has holes (D-035). Omit when contiguous. */
  tunableRangesKHz?: [number, number][];
  stepKHz: number;
  channelWidthKHz: number;
  guards?: Partial<Guards>;
  notes?: string;
  source: string;
  /**
   * Where the figures come from. The engine does not care; the interface must,
   * because a plan built on unchecked figures has to say so (D-034).
   */
  provenance: HardwareProvenance;
  verifiedAt?: string;
}
