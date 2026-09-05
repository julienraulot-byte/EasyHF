export { coordinate } from './assign.js';
export {
  checkPlan,
  distanceToInterval,
  findHostBand,
  halfWidthKHz,
  MARGIN_WINDOW_FACTOR,
  requiredExclusionKHz,
  requiredSpacingKHz,
} from './check.js';
export {
  DEFAULT_CONFIG,
  DEFAULT_GUARDS,
  DEFAULT_ROBUSTNESS_LADDER,
  resolveConfig,
  scaleGuards,
} from './config.js';
export { forEachImHit, isDegenerateResidual, type ImHit, type ImKind, type ImOptions } from './intermod.js';
export { buildGrid, clearanceProfile, freqAt, markBlocked, orderCandidates, type CandidateGrid } from './candidates.js';
export { relationBetween, type Relation } from './zones.js';
export { ENGINE_VERSION } from './version.js';
export type * from './types.js';
