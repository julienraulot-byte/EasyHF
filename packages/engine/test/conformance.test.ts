import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { checkPlan } from '../src/check.js';
import type { CorpusCase } from './conformance/generate.js';

/**
 * The corpus the Kotlin port will be held to (D-032).
 *
 * Regenerate with `pnpm --filter @easyhf/engine corpus`, and only on purpose:
 * a change to this file is a change to the engine's observable behaviour, and
 * it should be visible in a diff and argued for in a commit message.
 *
 * Here it does a second job: it is a wide regression net over the whole input
 * space, which the ten hand-written golden files never were.
 */
const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('./conformance/corpus.json', import.meta.url)), 'utf8'),
) as CorpusCase[];

describe('conformance corpus', () => {
  it('is broad enough to be worth calling one', () => {
    expect(corpus.length).toBeGreaterThan(500);
    const codes = new Set<string>();
    let blocks = 0;
    let holes = 0;
    let locked = 0;
    let degraded = 0;
    for (const item of corpus) {
      for (const violation of (item.output as { violations: { detail: { code: string } }[] }).violations) {
        codes.add(violation.detail.code);
      }
      for (const link of item.input.links) {
        if (link.kind === 'wmas') blocks += 1;
        if (link.tunableRangesKHz) holes += 1;
        if (link.lockedFreqKHz !== undefined) locked += 1;
      }
      const robustness = (item.output as { robustness?: { level: number } }).robustness;
      if (robustness && robustness.level > 0) degraded += 1;
    }
    // Every violation the engine can emit, and every shape of link.
    expect(codes.size, [...codes].join(', ')).toBe(7);
    expect({ blocks: blocks > 100, holes: holes > 100, locked: locked > 500, degraded: degraded > 0 }).toEqual({
      blocks: true,
      holes: true,
      locked: true,
      degraded: true,
    });
  });

  it('replays byte for byte, every case', () => {
    let coordinated = 0;
    let checked = 0;
    for (const item of corpus) {
      if (item.kind === 'coordinate') {
        const { engineVersion: _ignored, ...output } = coordinate(item.input);
        expect(output, `coordinate ${item.input.links[0]?.id}`).toEqual(item.output);
        coordinated += 1;
      } else {
        const { engineVersion: _ignored, ...output } = checkPlan({
          links: item.input.links,
          plan: item.plan ?? [],
          ...(item.input.exclusions ? { exclusions: item.input.exclusions } : {}),
          ...(item.input.bands ? { bands: item.input.bands } : {}),
          ...(item.input.zonePolicies ? { zonePolicies: item.input.zonePolicies } : {}),
          ...(item.input.config ? { config: item.input.config } : {}),
        });
        expect(output, `checkPlan ${item.input.links[0]?.id}`).toEqual(item.output);
        checked += 1;
      }
    }
    // Both halves are ported, so both are covered.
    expect(coordinated).toBeGreaterThan(200);
    expect(checked).toBeGreaterThan(200);
  });

  it('carries no prose, so a port reproduces numbers and not characters', () => {
    const raw = readFileSync(fileURLToPath(new URL('./conformance/corpus.json', import.meta.url)), 'utf8');
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(raw), 'le corpus contient des caractères non ASCII').toBe(false);
    expect(raw.includes('"message"')).toBe(false);
  });
});
