import { blockerFor, buildGrid, freqAt, markBlocked, orderCandidates, SCALE, type CandidateGrid } from './candidates.js';
import { checkPlan, findHostBand, halfWidthKHz, requiredExclusionKHz, requiredSpacingKHz } from './check.js';
import { resolveConfig, scaleGuards } from './config.js';
import { relationBetween } from './zones.js';
import { ENGINE_VERSION } from './version.js';
import type { CoordinateInput, CoordinationResult, EngineConfig, EngineLink, Guards, PlanEntry } from './types.js';

const REL_NONE = 0;
const REL_SPACING = 1;
const REL_FULL = 2;

interface Placed {
  linkIndex: number;
  freqKHz: number;
}

interface Attempt {
  assignments: Map<number, number>;
  complete: boolean;
  backtrackSteps: number;
  candidatesEvaluated: number;
}

/**
 * Deterministic frequency assignment.
 *
 * Greedy placement, most-constrained link first, with bounded backtracking; if
 * no complete plan exists at the nominal guards, the guards are relaxed one
 * rung down `config.robustnessLadder` and the whole search restarts. The plan
 * finally returned is re-checked by {@link checkPlan} against the guards that
 * were actually enforced, so `violations` and `ok` always describe the plan the
 * caller receives.
 *
 * There is no randomness anywhere in this function — no seed to record, and no
 * run-to-run variation to explain to a coordinator.
 */
export function coordinate(input: CoordinateInput): CoordinationResult {
  const config: EngineConfig = resolveConfig(input.config);
  const links = input.links;
  const n = links.length;
  const bands = input.bands ?? [];
  const exclusions = input.exclusions ?? [];

  const seenIds = new Set<string>();
  for (const link of links) {
    if (seenIds.has(link.id)) throw new Error(`Liaison en double dans links : ${link.id}`);
    seenIds.add(link.id);
  }

  const grids: CandidateGrid[] = links.map((link) =>
    buildGrid(link.tuningRangeKHz[0], link.tuningRangeKHz[1], link.stepKHz),
  );

  // Pairwise zone relation, resolved once. Symmetric by construction.
  const relation = new Uint8Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const r = relationBetween(
        (links[i] as EngineLink).zoneId,
        (links[j] as EngineLink).zoneId,
        input.zonePolicies,
      );
      relation[i * n + j] = r === 'full' ? REL_FULL : r === 'spacing' ? REL_SPACING : REL_NONE;
    }
  }

  const lockedIndices: number[] = [];
  const freeIndices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if ((links[i] as EngineLink).lockedFreqKHz !== undefined) lockedIndices.push(i);
    else freeIndices.push(i);
  }

  /** Bands + exclusions + tuning range: independent of what is already placed. */
  const staticMask = (linkIndex: number, guards: Guards): Uint8Array => {
    const link = links[linkIndex] as EngineLink;
    const grid = grids[linkIndex] as CandidateGrid;
    const mask = new Uint8Array(grid.count);
    const half = halfWidthKHz(link);
    if (bands.length > 0) {
      for (let k = 0; k < grid.count; k += 1) {
        if (!findHostBand(freqAt(grid, k), half, bands, config.allowTemporaryBands)) mask[k] = 1;
      }
    }
    const exclusionGuard = requiredExclusionKHz(link, guards.exclusionKHz);
    for (const exclusion of exclusions) {
      markBlocked(
        mask,
        grid,
        SCALE * (exclusion.fromKHz - exclusionGuard) + 1,
        SCALE * (exclusion.toKHz + exclusionGuard) - 1,
      );
    }
    return mask;
  };

  const buildMask = (
    linkIndex: number,
    placed: readonly Placed[],
    guards: Guards,
    base: Uint8Array,
  ): Uint8Array => {
    const link = links[linkIndex] as EngineLink;
    const grid = grids[linkIndex] as CandidateGrid;
    const mask = base.slice();
    const block = blockerFor(mask, grid);
    const g3a = guards.im3TwoTxKHz;
    const g3b = guards.im3ThreeTxKHz;
    const g5 = guards.im5TwoTxKHz;

    for (const p of placed) {
      const rel = relation[linkIndex * n + p.linkIndex] as number;
      if (rel === REL_NONE) continue;
      const required = requiredSpacingKHz(link, links[p.linkIndex] as EngineLink, guards.spacingKHz);
      block.around(p.freqKHz, required);
    }

    // Carriers that share an RF space with this link, i.e. can form products with it.
    const visible = placed.filter((p) => relation[linkIndex * n + p.linkIndex] === REL_FULL);
    const m = visible.length;
    if (m === 0) return mask;

    // --- This link as victim: products of the already-placed carriers.
    for (let a = 0; a < m; a += 1) {
      const fa = (visible[a] as Placed).freqKHz;
      for (let b = 0; b < m; b += 1) {
        if (b === a) continue;
        const fb = (visible[b] as Placed).freqKHz;
        block.around(2 * fa - fb, g3a);
        if (config.enableIm5TwoTx) block.around(3 * fa - 2 * fb, g5);
      }
    }
    if (config.enableIm3ThreeTx && m >= 3) {
      for (let a = 0; a < m; a += 1) {
        const fa = (visible[a] as Placed).freqKHz;
        for (let b = a + 1; b < m; b += 1) {
          const fb = (visible[b] as Placed).freqKHz;
          for (let c = 0; c < m; c += 1) {
            if (c === a || c === b) continue;
            block.around(fa + fb - (visible[c] as Placed).freqKHz, g3b);
          }
        }
      }
    }

    // --- This link as a generator: solve each product for the unknown carrier.
    // Bounds are exact integers in units of 1/6 kHz (see candidates.ts).
    for (let vi = 0; vi < m; vi += 1) {
      const victim = visible[vi] as Placed;
      const fv = victim.freqKHz;
      // Sources this victim can actually see. Mirrors checkPlan's `visible`.
      const sources = visible.filter(
        (p) => relation[victim.linkIndex * n + p.linkIndex] === REL_FULL,
      );
      const s = sources.length;

      for (let pi = 0; pi < s; pi += 1) {
        const p = sources[pi] as Placed;
        if (p.linkIndex === victim.linkIndex) continue; // victim in sources ⇒ pure spacing
        const fp = p.freqKHz;
        // 2f − p  ⇒  6f ∈ (3(fp + fv − g3a), 3(fp + fv + g3a))
        block.range(3 * (fp + fv - g3a) + 1, 3 * (fp + fv + g3a) - 1);
        // 2p − f  ⇒  6f ∈ (6(2fp − fv − g3a), 6(2fp − fv + g3a))
        block.around(2 * fp - fv, g3a);
        if (config.enableIm5TwoTx) {
          // 3f − 2p ⇒ 6f ∈ (2(2fp + fv − g5), 2(2fp + fv + g5))
          block.range(2 * (2 * fp + fv - g5) + 1, 2 * (2 * fp + fv + g5) - 1);
          // 3p − 2f ⇒ 6f ∈ (3(3fp − fv − g5), 3(3fp − fv + g5))
          block.range(3 * (3 * fp - fv - g5) + 1, 3 * (3 * fp - fv + g5) - 1);
        }
      }

      if (!config.enableIm3ThreeTx || s < 2) continue;
      for (let i1 = 0; i1 < s; i1 += 1) {
        const p1 = sources[i1] as Placed;
        // p1 is additive alongside this link; a victim that is an additive
        // source only re-states carrier spacing, so victim ≠ p1.
        if (p1.linkIndex === victim.linkIndex) continue;
        for (let i2 = 0; i2 < s; i2 += 1) {
          if (i2 === i1) continue;
          // f + p1 − p2 ⇒ f ∈ (fv + fp2 − fp1 ± g3b). p2 may be the victim.
          block.around(fv + (sources[i2] as Placed).freqKHz - p1.freqKHz, g3b);
        }
        // p1 + p2 − f, both additive, victim neither of them.
        for (let i2 = i1 + 1; i2 < s; i2 += 1) {
          const p2 = sources[i2] as Placed;
          if (p2.linkIndex === victim.linkIndex) continue;
          block.around(p1.freqKHz + p2.freqKHz - fv, g3b);
        }
      }
    }

    // --- This link as the subtractive source of a product hitting itself:
    // |p1 + p2 − 2f| < g3b  ⇒  6f ∈ (3(p1 + p2 − g3b), 3(p1 + p2 + g3b)).
    if (config.enableIm3ThreeTx && m >= 2) {
      for (let a = 0; a < m; a += 1) {
        const fa = (visible[a] as Placed).freqKHz;
        for (let b = a + 1; b < m; b += 1) {
          const sum = fa + (visible[b] as Placed).freqKHz;
          block.range(3 * (sum - g3b) + 1, 3 * (sum + g3b) - 1);
        }
      }
    }

    return mask;
  };

  const runLevel = (guards: Guards): Attempt => {
    const statics = new Map<number, Uint8Array>();
    const staticFor = (i: number): Uint8Array => {
      let cached = statics.get(i);
      if (!cached) {
        cached = staticMask(i, guards);
        statics.set(i, cached);
      }
      return cached;
    };

    const assignments = new Map<number, number>();
    const placed: Placed[] = [];
    for (const i of lockedIndices) {
      const freq = (links[i] as EngineLink).lockedFreqKHz as number;
      assignments.set(i, freq);
      placed.push({ linkIndex: i, freqKHz: freq });
    }
    placed.sort((a, b) => a.freqKHz - b.freqKHz || a.linkIndex - b.linkIndex);

    // Most constrained first: fewest statically usable candidates.
    const queue = [...freeIndices].sort((a, b) => {
      const freeA = staticFor(a).reduce((acc, blocked) => acc + (blocked === 0 ? 1 : 0), 0);
      const freeB = staticFor(b).reduce((acc, blocked) => acc + (blocked === 0 ? 1 : 0), 0);
      return freeA - freeB || (links[a] as EngineLink).id.localeCompare((links[b] as EngineLink).id);
    });

    const frames: ({ candidates: number[]; next: number } | undefined)[] = [];
    let depth = 0;
    let backtrackSteps = 0;
    let candidatesEvaluated = 0;
    let bestDepth = 0;
    let best = new Map(assignments);

    while (depth < queue.length) {
      const linkIndex = queue[depth] as number;
      let frame = frames[depth];
      if (!frame) {
        const mask = buildMask(linkIndex, placed, guards, staticFor(linkIndex));
        frame = { candidates: orderCandidates(mask, grids[linkIndex] as CandidateGrid, config.placementStrategy), next: 0 };
        frames[depth] = frame;
      }

      if (frame.next >= frame.candidates.length) {
        frames.length = depth;
        depth -= 1;
        if (depth < 0) break;
        const previous = queue[depth] as number;
        assignments.delete(previous);
        placed.splice(
          placed.findIndex((p) => p.linkIndex === previous),
          1,
        );
        (frames[depth] as { candidates: number[]; next: number }).next += 1;
        backtrackSteps += 1;
        if (backtrackSteps > config.maxBacktrackSteps) break;
        continue;
      }

      const freq = freqAt(grids[linkIndex] as CandidateGrid, frame.candidates[frame.next] as number);
      assignments.set(linkIndex, freq);
      placed.push({ linkIndex, freqKHz: freq });
      candidatesEvaluated += 1;
      depth += 1;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = new Map(assignments);
      }
    }

    const complete = depth >= queue.length;
    return {
      assignments: complete ? assignments : best,
      complete,
      backtrackSteps,
      candidatesEvaluated,
    };
  };

  let attempt: Attempt | undefined;
  let level = 0;
  let guards: Guards = config.guards;
  let levelsTried = 0;
  let totalBacktracks = 0;
  let totalCandidates = 0;

  for (const [index, factor] of config.robustnessLadder.entries()) {
    const levelGuards = scaleGuards(config.guards, factor);
    const result = runLevel(levelGuards);
    levelsTried += 1;
    totalBacktracks += result.backtrackSteps;
    totalCandidates += result.candidatesEvaluated;
    if (!attempt || result.assignments.size > attempt.assignments.size) {
      attempt = result;
      level = index;
      guards = levelGuards;
    }
    if (result.complete) {
      attempt = result;
      level = index;
      guards = levelGuards;
      break;
    }
  }

  const resolved = attempt as Attempt;
  const assignmentsList: PlanEntry[] = [...resolved.assignments.entries()]
    .map(([linkIndex, freqKHz]) => ({ linkId: (links[linkIndex] as EngineLink).id, freqKHz }))
    .sort((a, b) => a.freqKHz - b.freqKHz || a.linkId.localeCompare(b.linkId));

  const assignedIds = new Set(assignmentsList.map((entry) => entry.linkId));
  const unassignedLinkIds = links
    .map((link) => link.id)
    .filter((id) => !assignedIds.has(id))
    .sort();

  const verification = checkPlan({
    links,
    plan: assignmentsList,
    exclusions,
    bands,
    ...(input.zonePolicies ? { zonePolicies: input.zonePolicies } : {}),
    config: { ...config, guards },
  });

  return {
    ok: verification.ok && unassignedLinkIds.length === 0,
    assignments: assignmentsList,
    unassignedLinkIds,
    violations: verification.violations,
    margins: verification.margins,
    robustness: {
      level,
      factor: config.robustnessLadder[level] as number,
      guards,
      ladderLength: config.robustnessLadder.length,
    },
    stats: {
      backtrackSteps: totalBacktracks,
      candidatesEvaluated: totalCandidates,
      ladderLevelsTried: levelsTried,
    },
    engineVersion: ENGINE_VERSION,
  };
}
