import type { EngineConfig, EngineConfigInput, Guards } from './types.js';

/**
 * Default clearances.
 *
 * IM3 (200 kHz), IM5 (90 kHz), co-channel spacing (300 kHz) and the exclusion
 * guard (250 kHz) come from the build brief, §4 Phase 0. The 3-transmitter IM3
 * guard is not in the brief: it is set here to 100 kHz so that realistic link
 * counts remain reachable (D-006, validated). None of these are measured
 * values.
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
  maxBacktrackSteps: 50,
  placementStrategy: 'compact',
};

/**
 * Guards are whole, non-negative kHz. Nothing more is required of them.
 *
 * An earlier version also enforced `im3ThreeTx ≤ im3TwoTx ≤ spacing`, on the
 * grounds that the degeneracy rules in `intermod.ts` relied on it. Real
 * hardware profiles break that order — Shure's HD Robust profile spaces
 * carriers at 125 kHz and guards 2-transmitter products at 200 — so the rules
 * now compare guards explicitly where it matters instead (D-005, D-023).
 */
export function validateGuards(guards: Guards, label = 'gardes'): void {
  for (const [name, value] of Object.entries(guards)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} : garde ${name} invalide : ${value} kHz (entier ≥ 0 attendu)`);
    }
  }
}

export function resolveConfig(partial?: EngineConfigInput): EngineConfig {
  const guards: Guards = { ...DEFAULT_GUARDS, ...partial?.guards };
  validateGuards(guards);
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

/**
 * Nominal guards scaled by a ladder factor, rounded down to whole kHz. At
 * factor 1 this is the identity: the nominal rung enforces exactly the guards
 * the caller gave, so `coordinate` and a direct `checkPlan` agree on them.
 */
export function scaleGuards(guards: Guards, factor: number): Guards {
  return {
    im3TwoTxKHz: Math.floor(guards.im3TwoTxKHz * factor),
    im3ThreeTxKHz: Math.floor(guards.im3ThreeTxKHz * factor),
    im5TwoTxKHz: Math.floor(guards.im5TwoTxKHz * factor),
    spacingKHz: Math.floor(guards.spacingKHz * factor),
    exclusionKHz: Math.floor(guards.exclusionKHz * factor),
  };
}

/**
 * The guards each link is actually held to: its own overrides on top of the
 * global set, validated one by one so that a malformed hardware entry is
 * reported under the link's name.
 */
export function resolveLinkGuards(
  links: readonly { id: string; guards?: Partial<Guards> }[],
  globalGuards: Guards,
): Guards[] {
  return links.map((link) => {
    if (!link.guards) return globalGuards;
    const merged: Guards = { ...globalGuards, ...link.guards };
    validateGuards(merged, `Liaison « ${link.id} »`);
    return merged;
  });
}
