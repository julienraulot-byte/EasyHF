import type { EngineConfigInput, FreqKHz, InterZonePolicy } from '@easyhf/engine';

export type { FreqKHz };

export interface Venue {
  label: string;
  lat?: number;
  lon?: number;
}

/** A span of spectrum the plan must stay clear of. */
export interface Exclusion {
  fromKHz: FreqKHz;
  toKHz: FreqKHz;
  source: 'tnt-anfr' | 'scan' | 'manual' | 'regulatory';
  label: string;
}

/** An imported scan, kept by reference so a project stays small. */
export interface ScanRef {
  id: string;
  label: string;
  /** Where the scan was taken, when it matters (a scan is city-specific). */
  venueLabel?: string;
  capturedAt?: string;
  format: 'csv' | 'tinysa' | 'rf-explorer';
  /** Threshold, in dBm, above which a point became an exclusion. */
  thresholdDbm: number;
}

export interface Link {
  id: string;
  /** Operational name, e.g. `HF01 — Lead Vocal`. */
  label: string;
  /** Model id in `@easyhf/hardware-db`. */
  hardwareRef: string;
  role: 'mic' | 'iem' | 'intercom' | 'other';
  assignedFreqKHz?: FreqKHz;
  /** A locked frequency is imposed by the operator; the engine plans around it. */
  locked: boolean;
  /** Who is wearing it — the inventory side of the job. */
  wearer?: string;
}

export interface Zone {
  id: string;
  name: string;
  interZonePolicy: InterZonePolicy;
  links: Link[];
}

export interface Project {
  id: string;
  name: string;
  venue: Venue;
  zones: Zone[];
  scans: ScanRef[];
  exclusions: Exclusion[];
  engineConfig: EngineConfigInput;
  /** Version of the engine that produced the current plan. */
  engineVersion?: string;
  createdAt: string;
  updatedAt: string;
}

/** A regulatory band, as stored in `data/bands/<country>.json`. */
export interface Band {
  fromKHz: FreqKHz;
  toKHz: FreqKHz;
  status: 'free' | 'temporary' | 'forbidden';
  maxERPmW?: number;
  note?: string;
  label?: string;
}

export interface BandPlan {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** `YYYY-MM` of the last review. */
  updated: string;
  /** Regulatory decisions this plan is drawn from. Required — see DECISIONS.md. */
  sources: string[];
  bands: Band[];
}
