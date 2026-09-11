/**
 * Engine-local types.
 *
 * `@easyhf/engine` deliberately depends on nothing — not even `@easyhf/shared`.
 * The domain model (Project, Zone, ...) lives in `shared`, which adapts it to
 * the narrow structures below. Keeping the direction one-way means the engine
 * can be extracted, fuzzed or benchmarked in isolation.
 */

/** Every frequency in EasyHF is an integer number of kHz. Never a float in MHz. */
export type FreqKHz = number;

/** How a zone constrains the zones it is not part of. */
export type InterZonePolicy =
  /** Other zones' carriers take part in intermodulation, as if co-located. */
  | 'full-intermod'
  /** Other zones' carriers only impose a minimum carrier spacing. */
  | 'spacing-only'
  /** Other zones are ignored entirely (physically separate sites). */
  | 'isolated';

/** A tunable transmitter/receiver pair to be given a frequency. */
export interface EngineLink {
  id: string;
  /** Zone the link belongs to. Links with no zone share the implicit zone `''`. */
  zoneId: string;
  /** Inclusive tuning range of the hardware, from `hardware-db`. */
  tuningRangeKHz: readonly [FreqKHz, FreqKHz];
  /** Tuning grid of the hardware, in kHz. Candidates are `from + n * step`. */
  stepKHz: number;
  /**
   * Occupied RF bandwidth, in kHz: one carrier for a narrowband link, the whole
   * block for a WMAS link.
   */
  channelWidthKHz: number;
  /**
   * `narrowband` (default): a single carrier. Spacing and exclusions are
   * widened by the channel width; intermodulation distances are measured
   * centre to centre, as Wireless Workbench measures them.
   *
   * `wmas`: a Wideband Multichannel Audio System block (e.g. Sennheiser
   * Spectera, 6 or 8 MHz) carrying many audio links, coordinated internally by
   * its base station. `tuningRangeKHz` bounds the block's centre. The block is
   * a victim of every product that lands inside it or within its guard of its
   * edge; it is not a generator of products unless
   * `config.wmasAsImGenerator` says so (DECISIONS.md D-026).
   */
  kind?: 'narrowband' | 'wmas';
  /** Pre-imposed frequency. The engine never moves it; it plans around it. */
  lockedFreqKHz?: FreqKHz;
  /**
   * Clearances this hardware needs, overriding the global guards field by
   * field (DECISIONS.md D-006, D-023). Read receiver-side: intermodulation
   * guards are those of the carrier being hit, spacing is the larger of the
   * two carriers', the exclusion guard is the carrier's own.
   */
  guards?: Partial<Guards>;
}

/** A span of spectrum the plan must stay clear of. */
export interface EngineExclusion {
  fromKHz: FreqKHz;
  toKHz: FreqKHz;
  source: 'tnt-anfr' | 'scan' | 'manual' | 'regulatory';
  label: string;
}

/** A regulatory band, from `data/bands/<country>.json`. */
export interface EngineBand {
  fromKHz: FreqKHz;
  toKHz: FreqKHz;
  status: 'free' | 'temporary' | 'forbidden';
  label?: string;
}

export interface ZonePolicies {
  /** Zone id -> policy. Zones absent from the map default to `spacing-only`. */
  readonly [zoneId: string]: InterZonePolicy;
}

/**
 * Minimum clearances, in kHz. All are "strictly less than" thresholds.
 *
 * Third-order products are split by transmitter count: a 3-transmitter product
 * needs three carriers to coincide in the same non-linearity and lands well
 * below a 2-transmitter one, so it is given a tighter guard. See `DECISIONS.md`
 * D-006 for the measured effect on how many links fit in a band.
 *
 * No ordering between them is assumed: real profiles break it (Shure HD
 * Robust spaces carriers at 125 kHz and guards 2-transmitter products at 200).
 * `resolveConfig` only requires non-negative whole kHz.
 */
export interface Guards {
  /** Carrier to 3rd-order, 2-transmitter product (`2f1 − f2`). */
  im3TwoTxKHz: number;
  /** Carrier to 3rd-order, 3-transmitter product (`f1 + f2 − f3`). */
  im3ThreeTxKHz: number;
  /** Carrier to 5th-order, 2-transmitter product (`3f1 − 2f2`). */
  im5TwoTxKHz: number;
  /** Carrier to carrier. Widened per pair by the two channel widths. */
  spacingKHz: number;
  /** Carrier to exclusion edge. Widened by the carrier's own half-width. */
  exclusionKHz: number;
}

export interface EngineConfig {
  guards: Guards;
  /** Enable 3-transmitter 3rd-order products (`f1 + f2 - f3`). O(n^3). */
  enableIm3ThreeTx: boolean;
  /** Enable 2-transmitter 5th-order products (`3f1 - 2f2`). */
  enableIm5TwoTx: boolean;
  /** Allow assigning inside bands marked `temporary`. */
  allowTemporaryBands: boolean;
  /**
   * Successive guard multipliers tried by {@link coordinate} when a full plan
   * cannot be found at the previous level. Index 0 must be 1 (nominal guards).
   */
  robustnessLadder: readonly number[];
  /**
   * Upper bound on backtracking steps per search pass. A ladder level runs two
   * passes when 5th-order products are enabled (see `coordinate`).
   */
  maxBacktrackSteps: number;
  /** Which free candidate to take for a link. */
  placementStrategy: PlacementStrategy;
  /**
   * Treat WMAS blocks as intermodulation generators. Off by default: a
   * product of a 6 MHz OFDM block is spread over 6 to 12 MHz, so its density
   * in a narrowband receiver is 15 to 18 dB below a narrowband product's. On,
   * the product is taken as the whole interval it can occupy (D-026).
   */
  wmasAsImGenerator: boolean;
}

/**
 * How a link picks among the frequencies still open to it.
 *
 * `compact` takes the lowest one, keeping the whole plan inside as few TV
 * channels as possible — less spectrum to keep clean, more room left for the
 * other companies on site, and measurably more links placed before the guards
 * have to give (see `docs/DECISIONS.md`).
 *
 * `spread` takes the middle of the widest gap instead, trading footprint for
 * margin on each carrier. Worth it on small plans in quiet spectrum.
 */
export type PlacementStrategy = 'compact' | 'spread';

/**
 * What a caller may override. Guards can be overridden one at a time — the rest
 * fall back to {@link DEFAULT_GUARDS} — which is how most callers use them.
 */
export type EngineConfigInput = Partial<Omit<EngineConfig, 'guards'>> & {
  guards?: Partial<Guards>;
};

export type ViolationKind =
  | 'out-of-tuning-range'
  | 'im3-2tx'
  | 'im3-3tx'
  | 'im5-2tx'
  | 'spacing'
  | 'exclusion'
  | 'out-of-band';

/** `critical` blocks a plan; `warning` degrades it. */
export type Severity = 'critical' | 'warning';

export interface Violation {
  kind: ViolationKind;
  severity: Severity;
  /** Link whose assigned frequency is hit. */
  victimLinkId: string;
  victimFreqKHz: FreqKHz;
  /** Links generating the interfering product, in coefficient order. */
  sourceLinkIds: string[];
  /** Frequency of the offending product, carrier or exclusion edge. */
  offenderFreqKHz: FreqKHz;
  /** Clearance demanded by the config for this pair. */
  requiredKHz: number;
  /** Clearance actually available. */
  actualKHz: number;
  /** French, user-facing. */
  message: string;
}

export interface PlanEntry {
  linkId: string;
  freqKHz: FreqKHz;
}

export interface CheckInput {
  links: readonly EngineLink[];
  plan: readonly PlanEntry[];
  exclusions?: readonly EngineExclusion[];
  bands?: readonly EngineBand[];
  zonePolicies?: ZonePolicies;
  config?: EngineConfigInput;
}

/**
 * Smallest clearance observed across the whole plan, per constraint family.
 *
 * `null` means nothing of that family was found within the analysis window
 * (see `MARGIN_WINDOW_FACTOR`) — the comfortable case, not a missing value.
 */
export interface Margins {
  im3TwoTxKHz: number | null;
  im3ThreeTxKHz: number | null;
  im5TwoTxKHz: number | null;
  spacingKHz: number | null;
  exclusionKHz: number | null;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
  margins: Margins;
  engineVersion: string;
}

export interface CoordinateInput {
  links: readonly EngineLink[];
  exclusions?: readonly EngineExclusion[];
  bands?: readonly EngineBand[];
  zonePolicies?: ZonePolicies;
  config?: EngineConfigInput;
}

export interface CoordinationResult {
  /** True when every link got a frequency and no critical violation remains. */
  ok: boolean;
  assignments: PlanEntry[];
  /** Links the engine could not place, even at the last ladder level. */
  unassignedLinkIds: string[];
  violations: Violation[];
  margins: Margins;
  robustness: {
    /** Index in `config.robustnessLadder` that produced this plan. 0 = nominal. */
    level: number;
    /** Multiplier applied to the nominal guards at that level. */
    factor: number;
    /** The global guards at that level (nominal guards × factor). */
    guards: Guards;
    /**
     * The guards each link was actually held to, sorted by link id: its own
     * overrides on top of the global set, both scaled by `factor`. Passing
     * them back as each link's `guards` to `checkPlan`, with `guards` as the
     * config, reproduces the verification exactly.
     */
    linkGuards: { linkId: string; guards: Guards }[];
    /** Ladder length, so the UI can render `level + 1 / of`. */
    ladderLength: number;
  };
  /** Deterministic counters. No timings — a result must be byte-stable. */
  stats: {
    backtrackSteps: number;
    candidatesEvaluated: number;
    ladderLevelsTried: number;
  };
  engineVersion: string;
}
