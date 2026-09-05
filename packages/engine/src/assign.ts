import { blockerFor, buildGrid, freqAt, markBlocked, orderCandidates, SCALE, type CandidateGrid } from './candidates.js';
import { checkPlan, findHostBand, halfWidthKHz, requiredExclusionKHz, requiredSpacingKHz } from './check.js';
import { resolveConfig, scaleGuards } from './config.js';
import { compareIds } from './order.js';
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

interface Masks {
  /** Constraints that make a plan invalid. */
  hard: Uint8Array;
  /** `hard`, plus the 5th-order products that `checkPlan` reports as warnings. */
  soft: Uint8Array;
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
 * caller receives. That re-check is the engine's safety net: it is what turns a
 * search bug into a visible `ok: false` rather than a bad plan on a stage.
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

  /**
   * Frequencies this link may not take, given what is already placed.
   *
   * Two masks come back. `hard` carries what makes a plan invalid: carrier
   * spacing, exclusions, bands and third-order intermodulation. `soft` adds the
   * fifth-order products, which `checkPlan` only reports as warnings. The
   * search prefers a `soft`-free frequency but will take a merely `hard`-free
   * one, rather than weaken a guard that actually matters to avoid a warning.
   *
   * Visibility is the subtle part. A product counts against a victim only when
   * every generator is visible to **the victim** — never to the link being
   * placed. Under three zones with differing policies those are not the same
   * set:
   *
   * | role of this link | victim  | generators must be visible to |
   * |-------------------|---------|-------------------------------|
   * | victim            | itself  | this link                     |
   * | generator         | a placed carrier | that carrier         |
   *
   * Filtering generators by what *this* link can see silently drops products
   * that reach the victim through a zone this link happens to be isolated from.
   */
  const buildMask = (
    linkIndex: number,
    placed: readonly Placed[],
    guards: Guards,
    base: Uint8Array,
  ): Masks => {
    const link = links[linkIndex] as EngineLink;
    const grid = grids[linkIndex] as CandidateGrid;
    const hard = base.slice();
    const block = blockerFor(hard, grid);
    const g3a = guards.im3TwoTxKHz;
    const g3b = guards.im3ThreeTxKHz;

    for (const p of placed) {
      if (relation[linkIndex * n + p.linkIndex] === REL_NONE) continue;
      const required = requiredSpacingKHz(link, links[p.linkIndex] as EngineLink, guards.spacingKHz);
      block.around(p.freqKHz, required);
    }

    // Carriers that can reach this link: the generators of any product it can
    // fall victim to.
    const visible = placed.filter((p) => relation[linkIndex * n + p.linkIndex] === REL_FULL);
    const m = visible.length;
    if (m === 0) return { hard, soft: hard };

    // Generators visible to each placed victim. Read from `placed`, not from
    // `visible` — see the visibility table above.
    const sourcesFor = visible.map((victim) =>
      placed.filter(
        (p) =>
          p.linkIndex !== victim.linkIndex &&
          relation[victim.linkIndex * n + p.linkIndex] === REL_FULL,
      ),
    );

    // --- This link as victim: products of the carriers already placed.
    for (let a = 0; a < m; a += 1) {
      const fa = (visible[a] as Placed).freqKHz;
      for (let b = 0; b < m; b += 1) {
        if (b === a) continue;
        block.around(2 * fa - (visible[b] as Placed).freqKHz, g3a);
      }
    }
    if (config.enableIm3ThreeTx && m >= 3) {
      for (let a = 0; a < m; a += 1) {
        const fa = (visible[a] as Placed).freqKHz;
        for (let b = a + 1; b < m; b += 1) {
          const sum = fa + (visible[b] as Placed).freqKHz;
          for (let c = 0; c < m; c += 1) {
            if (c === a || c === b) continue;
            block.around(sum - (visible[c] as Placed).freqKHz, g3b);
          }
        }
      }
    }

    // --- This link as a generator: each product solved for the unknown carrier.
    // Bounds are exact integers in units of 1/6 kHz (see candidates.ts).
    for (let vi = 0; vi < m; vi += 1) {
      const fv = (visible[vi] as Placed).freqKHz;
      const sources = sourcesFor[vi] as Placed[];
      const s = sources.length;

      for (let pi = 0; pi < s; pi += 1) {
        const fp = (sources[pi] as Placed).freqKHz;
        // 2f − p  ⇒  6f ∈ (3(fp + fv − g3a), 3(fp + fv + g3a))
        block.range(3 * (fp + fv - g3a) + 1, 3 * (fp + fv + g3a) - 1);
        // 2p − f  ⇒  |2fp − fv − f| < g3a
        block.around(2 * fp - fv, g3a);
      }

      if (!config.enableIm3ThreeTx || s < 2) continue;
      for (let i1 = 0; i1 < s; i1 += 1) {
        const fp1 = (sources[i1] as Placed).freqKHz;
        for (let i2 = 0; i2 < s; i2 += 1) {
          if (i2 === i1) continue;
          // f + p1 − p2 hitting v ⇒ f ∈ (fv + fp2 − fp1 ± g3b)
          block.around(fv + (sources[i2] as Placed).freqKHz - fp1, g3b);
        }
        for (let i2 = i1 + 1; i2 < s; i2 += 1) {
          // p1 + p2 − f hitting v ⇒ f ∈ (fp1 + fp2 − fv ± g3b)
          block.around(fp1 + (sources[i2] as Placed).freqKHz - fv, g3b);
        }
      }
    }

    if (!config.enableIm5TwoTx) return { hard, soft: hard };

    // --- Fifth order, on the soft mask only.
    const soft = hard.slice();
    const blockSoft = blockerFor(soft, grid);
    const g5 = guards.im5TwoTxKHz;
    for (let a = 0; a < m; a += 1) {
      const fa = (visible[a] as Placed).freqKHz;
      for (let b = 0; b < m; b += 1) {
        if (b === a) continue;
        blockSoft.around(3 * fa - 2 * (visible[b] as Placed).freqKHz, g5);
      }
    }
    for (let vi = 0; vi < m; vi += 1) {
      const fv = (visible[vi] as Placed).freqKHz;
      for (const p of sourcesFor[vi] as Placed[]) {
        const fp = p.freqKHz;
        // 3f − 2p ⇒ 6f ∈ (2(2fp + fv − g5), 2(2fp + fv + g5))
        blockSoft.range(2 * (2 * fp + fv - g5) + 1, 2 * (2 * fp + fv + g5) - 1);
        // 3p − 2f ⇒ 6f ∈ (3(3fp − fv − g5), 3(3fp − fv + g5))
        blockSoft.range(3 * (3 * fp - fv - g5) + 1, 3 * (3 * fp - fv + g5) - 1);
      }
    }
    return { hard, soft };
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
    const staticFreeCount = new Map<number, number>();
    for (const i of freeIndices) {
      let free = 0;
      const mask = staticFor(i);
      for (let k = 0; k < mask.length; k += 1) if (mask[k] === 0) free += 1;
      staticFreeCount.set(i, free);
    }
    const queue = [...freeIndices].sort(
      (a, b) =>
        (staticFreeCount.get(a) as number) - (staticFreeCount.get(b) as number) ||
        compareIds((links[a] as EngineLink).id, (links[b] as EngineLink).id),
    );

    const frames: ({ candidates: number[]; next: number } | undefined)[] = [];
    let depth = 0;
    let backtrackSteps = 0;
    let candidatesEvaluated = 0;
    let bestDepth = 0;
    let best = new Map(assignments);

    while (depth < queue.length) {
      const linkIndex = queue[depth] as number;
      const grid = grids[linkIndex] as CandidateGrid;
      let frame = frames[depth];
      if (!frame) {
        const { hard, soft } = buildMask(linkIndex, placed, guards, staticFor(linkIndex));
        // Fifth-order-clean frequencies first, then the rest. A warning never
        // costs a rung on the robustness ladder.
        const preferred = orderCandidates(soft, grid, config.placementStrategy);
        const fallback =
          soft === hard
            ? []
            : orderCandidates(hard, grid, config.placementStrategy).filter((k) => soft[k] === 1);
        frame = { candidates: [...preferred, ...fallback], next: 0 };
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

      const freq = freqAt(grid, frame.candidates[frame.next] as number);
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
    .sort((a, b) => a.freqKHz - b.freqKHz || compareIds(a.linkId, b.linkId));

  const assignedIds = new Set(assignmentsList.map((entry) => entry.linkId));
  const unassignedLinkIds = links
    .map((link) => link.id)
    .filter((id) => !assignedIds.has(id))
    .sort(compareIds);

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
