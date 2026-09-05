import type { EngineConfig, Guards } from './types.js';

/**
 * Default clearances.
 *
 * IM3 (200 kHz), IM5 (90 kHz), co-channel spacing (300 kHz) and the exclusion
 * guard (250 kHz) come from the build brief, §4 Phase 0. The 3-transmitter IM3
 * guard is not in the brief: it is set here to 100 kHz so that realistic link
 * counts remain reachable, and is flagged `[À VALIDER JULIEN]` in
 * `docs/DECISIONS.md`. None of these are measured values.
 */
export const DEFAULT_GUARDS: Guards = {
  im3TwoTxKHz: 200,
  im3ThreeTxKHz: 100,
  im5TwoTxKHz: 90,
  spacingKHz: 300,
  exclusionKHz: 250,
};

/**
 * Guard multipliers tried in order when a complete plan cannot be found.
 *
 * The "robustness index" of the resulting plan is the index reached: 0 means
 * every nominal guard held, higher means the engine had to give ground. The
 * UI must surface it — a level-3 plan is a plan the operator should look at.
 */
export const DEFAULT_ROBUSTNESS_LADDER: readonly number[] = [1, 0.8, 0.6, 0.45, 0.3];

export const DEFAULT_CONFIG: EngineConfig = {
  guards: DEFAULT_GUARDS,
  enableIm3ThreeTx: true,
  enableIm5TwoTx: true,
  allowTemporaryBands: true,
  robustnessLadder: DEFAULT_ROBUSTNESS_LADDER,
  maxBacktrackSteps: 200,
  placementStrategy: 'compact',
};

export function resolveConfig(partial?: Partial<EngineConfig>): EngineConfig {
  const guards: Guards = { ...DEFAULT_GUARDS, ...partial?.guards };
  const ladder = partial?.robustnessLadder ?? DEFAULT_ROBUSTNESS_LADDER;
  if (ladder.length === 0) throw new Error('robustnessLadder ne peut pas être vide');
  if (ladder[0] !== 1) throw new Error('robustnessLadder[0] doit valoir 1 (gardes nominales)');
  for (const [i, factor] of ladder.entries()) {
    if (!(factor > 0) || factor > 1) {
      throw new Error(`robustnessLadder[${i}] doit être dans ]0, 1], reçu ${factor}`);
    }
    if (i > 0 && factor >= (ladder[i - 1] as number)) {
      throw new Error('robustnessLadder doit être strictement décroissante');
    }
  }
  return { ...DEFAULT_CONFIG, ...partial, guards, robustnessLadder: ladder };
}

/** Nominal guards scaled by a ladder factor, rounded down to whole kHz. */
export function scaleGuards(guards: Guards, factor: number): Guards {
  return {
    im3TwoTxKHz: Math.floor(guards.im3TwoTxKHz * factor),
    im3ThreeTxKHz: Math.floor(guards.im3ThreeTxKHz * factor),
    im5TwoTxKHz: Math.floor(guards.im5TwoTxKHz * factor),
    spacingKHz: Math.floor(guards.spacingKHz * factor),
    exclusionKHz: Math.floor(guards.exclusionKHz * factor),
  };
}
