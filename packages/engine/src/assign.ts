import { blockerFor, buildGrid, freqAt, markBlocked, orderCandidates, SCALE, type CandidateGrid } from './candidates.js';
import {
  allowedSpans,
  checkPlan,
  fitsAllowedSpan,
  generatesIm,
  halfWidthKHz,
  imHalfWidthKHz,
  requiredExclusionKHz,
  requiredSpacingKHz,
  validExclusions,
} from './check.js';
import { resolveConfig, resolveLinkGuards, scaleGuards } from './config.js';
import { compareIds } from './order.js';
import { RELATION_RANK, relationBetween } from './zones.js';
import { ENGINE_VERSION } from './version.js';
import type { CoordinateInput, CoordinationResult, EngineConfig, EngineLink, Guards, PlanEntry } from './types.js';

const REL = RELATION_RANK;

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
  const nominalLinkGuards = resolveLinkGuards(links, config.guards);
  const bands = input.bands ?? [];
  const spans = allowedSpans(bands, config.allowTemporaryBands);
  const exclusions = validExclusions(input.exclusions);

  const seenIds = new Set<string>();
  for (const link of links) {
    if (seenIds.has(link.id)) throw new Error(`Liaison en double dans links : ${link.id}`);
    seenIds.add(link.id);
  }

  const grids: CandidateGrid[] = links.map((link) =>
    buildGrid(link.tuningRangeKHz[0], link.tuningRangeKHz[1], link.stepKHz),
  );
  const imHalf: number[] = links.map(imHalfWidthKHz);
  const generates: boolean[] = links.map((link) => generatesIm(link, config));

  // Pairwise zone relation, resolved once. Symmetric by construction.
  const relation = new Uint8Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      relation[i * n + j] =
        REL[relationBetween((links[i] as EngineLink).zoneId, (links[j] as EngineLink).zoneId, input.zonePolicies)];
    }
  }
  const rel = (a: number, b: number): number => relation[a * n + b] as number;

  const lockedIndices: number[] = [];
  const freeIndices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if ((links[i] as EngineLink).lockedFreqKHz !== undefined) lockedIndices.push(i);
    else freeIndices.push(i);
  }

  /** Bands + exclusions + tuning range: independent of what is already placed. */
  const staticMask = (linkIndex: number, guards: readonly Guards[]): Uint8Array => {
    const link = links[linkIndex] as EngineLink;
    const grid = grids[linkIndex] as CandidateGrid;
    const mask = new Uint8Array(grid.count);
    const half = halfWidthKHz(link);
    if (bands.length > 0) {
      for (let k = 0; k < grid.count; k += 1) {
        if (!fitsAllowedSpan(freqAt(grid, k), half, spans)) mask[k] = 1;
      }
    }
    const exclusionGuard = requiredExclusionKHz(link, (guards[linkIndex] as Guards).exclusionKHz);
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
   * fifth-order products, which `checkPlan` only reports as warnings.
   *
   * This function is the mirror image of `forEachImHit`: where the checker
   * enumerates products and measures distances, this solves each product for
   * the unknown carrier and blocks the interval it may not fall in. Every rule
   * there has its counterpart here, under the same visibility condition — a
   * product counts against a victim only when every generator is `full` with
   * **the victim**. Which victim, and who must see whom, depends on the role
   * the new carrier `f` plays in the product:
   *
   *   f as …        victim         generators must be full with
   *   ─────────────────────────────────────────────────────────────
   *   victim        f              f            (`visible` below)
   *   generator     a placed p     p            (`sourcesFor[p]` below)
   *
   * `sourcesFor` is read from `placed`, not from `visible`: a generator the
   * victim can see need not be one this link can see. And, as in the checker,
   * a product hitting one of its own generators is blocked only when the rule
   * that normally covers it does not run across the zones involved.
   */
  const buildMask = (
    linkIndex: number,
    placed: readonly Placed[],
    guards: readonly Guards[],
    base: Uint8Array,
  ): Masks => {
    const grid = grids[linkIndex] as CandidateGrid;
    const hard = base.slice();
    const block = blockerFor(hard, grid);
    const own = guards[linkIndex] as Guards;
    const g3a = own.im3TwoTxKHz;
    const g3b = own.im3ThreeTxKHz;
    const threeTx = config.enableIm3ThreeTx;
    // Wideband blocks (D-026): `hf` widens every product the new carrier takes
    // part in, `gf` says whether it generates any. A guard of 0 switches the
    // rule off, widening or not — as `distance < 0` never holds in the checker.
    const hf = imHalf[linkIndex] as number;
    const gf = generates[linkIndex] as boolean;
    const h = (p: Placed): number => imHalf[p.linkIndex] as number;
    const spacingWith = (a: number, b: number): number =>
      requiredSpacingKHz(
        links[a] as EngineLink,
        links[b] as EngineLink,
        (guards[a] as Guards).spacingKHz,
        (guards[b] as Guards).spacingKHz,
      );
    /** Blocks `|f − centre| < guard + widening`, unless the rule is off. */
    const around = (blocker: ReturnType<typeof blockerFor>, centreKHz: number, guard: number, widening: number): void => {
      if (guard > 0) blocker.around(centreKHz, guard + widening);
    };
    /** Blocks `|k·f − centre| < guard + widening`, in exact sixths. */
    const scaled = (blocker: ReturnType<typeof blockerFor>, k: 2 | 3, centreKHz: number, guard: number, widening: number): void => {
      if (guard <= 0) return;
      const G = guard + widening;
      const unit = SCALE / k;
      blocker.range(unit * (centreKHz - G) + 1, unit * (centreKHz + G) - 1);
    };

    for (const p of placed) {
      if (rel(linkIndex, p.linkIndex) === REL.none) continue;
      block.around(p.freqKHz, spacingWith(linkIndex, p.linkIndex));
    }

    // Carriers full with this link: the generators of any product it can fall
    // victim to, and the victims of any product it generates.
    const visible = placed.filter((p) => rel(linkIndex, p.linkIndex) === REL.full);
    if (visible.length === 0) return { hard, soft: hard };
    const gens = visible.filter((p) => generates[p.linkIndex]);
    const m = gens.length;

    // Generators full with each placed victim.
    const sourcesFor = visible.map((victim) =>
      placed.filter(
        (p) => p.linkIndex !== victim.linkIndex && generates[p.linkIndex] && rel(victim.linkIndex, p.linkIndex) === REL.full,
      ),
    );

    // --- f as victim of products of the placed generators.
    for (let a = 0; a < m; a += 1) {
      const pa = gens[a] as Placed;
      for (let b = 0; b < m; b += 1) {
        if (b === a) continue;
        const pb = gens[b] as Placed;
        around(block, 2 * pa.freqKHz - pb.freqKHz, g3a, hf + 2 * h(pa) + h(pb));
      }
    }
    if (threeTx) {
      for (let a = 0; a < m; a += 1) {
        const pa = gens[a] as Placed;
        for (let b = a + 1; b < m; b += 1) {
          const pb = gens[b] as Placed;
          const sum = pa.freqKHz + pb.freqKHz;
          for (let c = 0; c < m; c += 1) {
            if (c === a || c === b) continue;
            const pc = gens[c] as Placed;
            around(block, sum - pc.freqKHz, g3b, hf + h(pa) + h(pb) + h(pc));
          }
          if (!gf) continue;
          // f as its own generator, with pa and pb the other two (D-005: the
          // rule that measures the residual decides, whatever its guard):
          const relAB = rel(pa.linkIndex, pb.linkIndex);
          const widening = 2 * hf + h(pa) + h(pb);
          // f + pa − pb hits f  ⇒  |pa − pb| < g3b, for every f. Spacing
          // (pa, pb) decides unless it is skipped between isolated zones.
          if (relAB === REL.none && g3b > 0 && Math.abs(pa.freqKHz - pb.freqKHz) < g3b + widening) hard.fill(1);
          // pa + pb − f hits f  ⇒  |pa + pb − 2f| < g3b. The 2-transmitter
          // forms decide, and they run only when pa and pb see each other.
          if (relAB !== REL.full) scaled(block, 2, sum, g3b, widening);
        }
      }
    }

    // --- f as a generator: each product solved for f, per placed victim.
    // Bounds are exact integers in units of 1/6 kHz (see candidates.ts).
    if (gf) {
      for (let vi = 0; vi < visible.length; vi += 1) {
        const victim = visible[vi] as Placed;
        const fv = victim.freqKHz;
        const hv = h(victim);
        const gv = generates[victim.linkIndex] as boolean;
        const guardsV = guards[victim.linkIndex] as Guards;
        const v3a = guardsV.im3TwoTxKHz;
        const v3b = guardsV.im3ThreeTxKHz;
        const sources = sourcesFor[vi] as Placed[];
        const s = sources.length;

        for (let pi = 0; pi < s; pi += 1) {
          const p = sources[pi] as Placed;
          const fp = p.freqKHz;
          const hp = h(p);
          // 2f − p hits v  ⇒  |2f − (fp + fv)| < v3a
          scaled(block, 2, fp + fv, v3a, 2 * hf + hp + hv);
          // 2p − f hits v  ⇒  |f − (2fp − fv)| < v3a
          around(block, 2 * fp - fv, v3a, hf + 2 * hp + hv);

          if (!threeTx || !gv) continue;
          const relFP = rel(linkIndex, p.linkIndex);
          // v as additive generator alongside f (f + v − p) or alongside p
          // (p + v − f): residual |f − p|, which spacing(f, p) decides unless
          // it is skipped between isolated zones.
          if (relFP === REL.none) around(block, fp, v3b, hf + 2 * hv + hp);
          // v as subtractive generator (f + p − v hits v): residual |f + p − 2v|,
          // which the 2-transmitter forms against f and against p decide; they
          // run only when f and p see each other.
          if (relFP !== REL.full) around(block, 2 * fv - fp, v3b, hf + hp + 2 * hv);
        }

        if (!threeTx || s < 2) continue;
        for (let i1 = 0; i1 < s; i1 += 1) {
          const p1 = sources[i1] as Placed;
          for (let i2 = 0; i2 < s; i2 += 1) {
            if (i2 === i1) continue;
            const p2 = sources[i2] as Placed;
            // f + p1 − p2 hits v  ⇒  f ∈ (fv + fp2 − fp1 ± v3b)
            around(block, fv + p2.freqKHz - p1.freqKHz, v3b, hf + h(p1) + h(p2) + hv);
          }
          for (let i2 = i1 + 1; i2 < s; i2 += 1) {
            const p2 = sources[i2] as Placed;
            // p1 + p2 − f hits v  ⇒  f ∈ (fp1 + fp2 − fv ± v3b)
            around(block, p1.freqKHz + p2.freqKHz - fv, v3b, hf + h(p1) + h(p2) + hv);
          }
        }
      }
    }

    if (!config.enableIm5TwoTx) return { hard, soft: hard };

    // --- Fifth order, on the soft mask only.
    const soft = hard.slice();
    const blockSoft = blockerFor(soft, grid);
    const g5 = own.im5TwoTxKHz;
    for (let a = 0; a < m; a += 1) {
      const pa = gens[a] as Placed;
      for (let b = 0; b < m; b += 1) {
        if (b === a) continue;
        const pb = gens[b] as Placed;
        around(blockSoft, 3 * pa.freqKHz - 2 * pb.freqKHz, g5, hf + 3 * h(pa) + 2 * h(pb));
      }
    }
    if (gf) {
      for (let vi = 0; vi < visible.length; vi += 1) {
        const victim = visible[vi] as Placed;
        const fv = victim.freqKHz;
        const hv = h(victim);
        const v5 = (guards[victim.linkIndex] as Guards).im5TwoTxKHz;
        for (const p of sourcesFor[vi] as Placed[]) {
          const fp = p.freqKHz;
          const hp = h(p);
          // 3f − 2p hits v  ⇒  |3f − (2fp + fv)| < v5
          scaled(blockSoft, 3, 2 * fp + fv, v5, 3 * hf + 2 * hp + hv);
          // 3p − 2f hits v  ⇒  |2f − (3fp − fv)| < v5
          scaled(blockSoft, 2, 3 * fp - fv, v5, 2 * hf + 3 * hp + hv);
        }
      }
    }
    return { hard, soft };
  };

  /**
   * One greedy search at a fixed set of guards.
   *
   * `preferIm5Clean` puts the fifth-order-clean frequencies first in each
   * link's candidate list. That preference changes the path the greedy takes,
   * and with a bounded backtracking budget a different path can fail where the
   * plain one succeeds — so a level is only given up after both have been tried.
   */
  const runLevel = (guards: readonly Guards[], preferIm5Clean: boolean): Attempt => {
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
        let candidates: number[];
        if (preferIm5Clean && soft !== hard) {
          const preferred = orderCandidates(soft, grid, config.placementStrategy);
          const fallback = orderCandidates(hard, grid, config.placementStrategy).filter((k) => soft[k] === 1);
          candidates = [...preferred, ...fallback];
        } else {
          candidates = orderCandidates(hard, grid, config.placementStrategy);
        }
        frame = { candidates, next: 0 };
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

  let linkGuards: Guards[] = nominalLinkGuards;
  ladder: for (const [index, factor] of config.robustnessLadder.entries()) {
    const levelGuards = scaleGuards(config.guards, factor);
    const levelLinkGuards = nominalLinkGuards.map((g) => scaleGuards(g, factor));
    levelsTried += 1;
    // Fifth-order-clean first; then, before giving up a rung of real guards
    // over what is only a warning, the same rung without the preference.
    for (const preferIm5Clean of config.enableIm5TwoTx ? [true, false] : [false]) {
      const result = runLevel(levelLinkGuards, preferIm5Clean);
      totalBacktracks += result.backtrackSteps;
      totalCandidates += result.candidatesEvaluated;
      if (!attempt || result.assignments.size > attempt.assignments.size) {
        attempt = result;
        level = index;
        guards = levelGuards;
        linkGuards = levelLinkGuards;
      }
      if (result.complete) {
        attempt = result;
        level = index;
        guards = levelGuards;
        linkGuards = levelLinkGuards;
        break ladder;
      }
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

  // Re-checked against the guards each link was actually held to at the
  // rung that produced the plan — including the scaled per-link overrides.
  const verification = checkPlan({
    links: links.map((link, i) => ({ ...link, guards: linkGuards[i] as Guards })),
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
      linkGuards: links
        .map((link, i) => ({ linkId: link.id, guards: linkGuards[i] as Guards }))
        .sort((a, b) => compareIds(a.linkId, b.linkId)),
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
