import type { EngineConfig, EngineConfigInput, Guards } from './types.js';

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
  maxBacktrackSteps: 100,
  placementStrategy: 'compact',
};

/**
 * Checks the guards against each other.
 *
 * A product hitting one of its own generators is skipped whenever another rule
 * covers that case — and "covers" must mean "at least as strictly", which only
 * holds while the guards keep the order below (see `intermod.ts`). So the order
 * is enforced rather than assumed: a user who lowers the carrier spacing below
 * the IM3 guard would otherwise silently lose detections.
 */
function validateGuards(guards: Guards): void {
  for (const [name, value] of Object.entries(guards)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Garde ${name} invalide : ${value} kHz (entier ≥ 0 attendu)`);
    }
  }
  if (guards.im3ThreeTxKHz > guards.im3TwoTxKHz) {
    throw new Error(
      `La garde IM3 à 3 émetteurs (${guards.im3ThreeTxKHz} kHz) ne peut pas dépasser celle à ` +
        `2 émetteurs (${guards.im3TwoTxKHz} kHz) : un produit à 3 émetteurs qui retombe sur son ` +
        `propre générateur soustractif est vérifié sous sa forme à 2 émetteurs.`,
    );
  }
  if (guards.spacingKHz < guards.im3TwoTxKHz) {
    throw new Error(
      `L'espacement co-canal (${guards.spacingKHz} kHz) ne peut pas être inférieur à la garde IM3 ` +
        `à 2 émetteurs (${guards.im3TwoTxKHz} kHz) : c'est lui qui couvre les produits retombant ` +
        `sur leurs propres générateurs.`,
    );
  }
  if (2 * guards.spacingKHz < guards.im5TwoTxKHz) {
    throw new Error(
      `L'espacement co-canal (${guards.spacingKHz} kHz) doit valoir au moins la moitié de la garde ` +
        `IM5 (${guards.im5TwoTxKHz} kHz), pour la même raison.`,
    );
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
 * Nominal guards scaled by a ladder factor, rounded down to whole kHz.
 *
 * `floor` is monotone, so the `im3ThreeTx ≤ im3TwoTx ≤ spacing` order survives
 * scaling on its own. `2·spacing ≥ im5` does not — `floor(0.3 × 45) = 13` but
 * `floor(0.3 × 90) = 27` — so it is restored explicitly, or the re-check at the
 * end of `coordinate` would reject guards the ladder itself produced.
 */
export function scaleGuards(guards: Guards, factor: number): Guards {
  const spacingKHz = Math.floor(guards.spacingKHz * factor);
  return {
    im3TwoTxKHz: Math.floor(guards.im3TwoTxKHz * factor),
    im3ThreeTxKHz: Math.floor(guards.im3ThreeTxKHz * factor),
    im5TwoTxKHz: Math.min(Math.floor(guards.im5TwoTxKHz * factor), 2 * spacingKHz),
    spacingKHz,
    exclusionKHz: Math.floor(guards.exclusionKHz * factor),
  };
}
