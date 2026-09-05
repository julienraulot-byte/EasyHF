import { describe, expect, it } from 'vitest';
import {
  buildGrid,
  clearanceProfile,
  freqAt,
  markBlocked,
  orderCandidates,
  SCALE,
} from '../src/candidates.js';

describe('buildGrid', () => {
  it('counts the tunable points inclusively', () => {
    expect(buildGrid(470_000, 470_100, 25).count).toBe(5);
    expect(buildGrid(470_000, 470_000, 25).count).toBe(1);
  });

  it('ignores a partial trailing step', () => {
    expect(buildGrid(470_000, 470_110, 25).count).toBe(5);
  });

  it('rejects malformed ranges', () => {
    expect(() => buildGrid(470_000, 469_000, 25)).toThrow(/inversée/);
    expect(() => buildGrid(470_000, 471_000, 0)).toThrow(/Pas d'accord/);
    expect(() => buildGrid(470_000.5, 471_000, 25)).toThrow(/non entière/);
  });
});

describe('markBlocked', () => {
  const grid = buildGrid(500_000, 500_500, 25);

  it('blocks exactly the candidates inside a closed scaled range', () => {
    const mask = new Uint8Array(grid.count);
    markBlocked(mask, grid, SCALE * 500_100, SCALE * 500_150);
    const blocked = [...mask].flatMap((v, i) => (v === 1 ? [freqAt(grid, i)] : []));
    expect(blocked).toEqual([500_100, 500_125, 500_150]);
  });

  it('excludes the endpoints of an open constraint', () => {
    // |f − 500 200| < 100 must block 500 125…500 275, but neither 500 100 nor
    // 500 300, which sit exactly on the guard.
    const mask = new Uint8Array(grid.count);
    markBlocked(mask, grid, SCALE * (500_200 - 100) + 1, SCALE * (500_200 + 100) - 1);
    const blocked = [...mask].flatMap((v, i) => (v === 1 ? [freqAt(grid, i)] : []));
    expect(blocked).toEqual([500_125, 500_150, 500_175, 500_200, 500_225, 500_250, 500_275]);
  });

  it('resolves thirds of a kHz without rounding', () => {
    // 6f ∈ (2·(2p + v − g), 2·(2p + v + g)) with 2p + v = 1 500 001 and g = 50
    // gives f ∈ (499 983.67, 500 016.33): 500 000 blocked, 499 975 and 500 025 free.
    const fine = buildGrid(499_900, 500_100, 25);
    const mask = new Uint8Array(fine.count);
    markBlocked(mask, fine, 2 * (1_500_001 - 50) + 1, 2 * (1_500_001 + 50) - 1);
    const blocked = [...mask].flatMap((v, i) => (v === 1 ? [freqAt(fine, i)] : []));
    expect(blocked).toEqual([500_000]);
  });

  it('clamps to the grid and ignores empty ranges', () => {
    const mask = new Uint8Array(grid.count);
    markBlocked(mask, grid, SCALE * 400_000, SCALE * 600_000);
    expect([...mask].every((v) => v === 1)).toBe(true);
    const other = new Uint8Array(grid.count);
    markBlocked(other, grid, SCALE * 500_100, SCALE * 500_100 - 1);
    expect([...other].every((v) => v === 0)).toBe(true);
  });
});

describe('clearanceProfile', () => {
  it('measures the distance to the nearest blocked candidate or edge', () => {
    const mask = Uint8Array.from([0, 0, 1, 0, 0, 0, 0]);
    expect([...clearanceProfile(mask, mask.length)]).toEqual([1, 1, 0, 1, 2, 2, 1]);
  });
});

describe('orderCandidates', () => {
  const grid = buildGrid(500_000, 500_150, 25);

  it('packs from the bottom with compact', () => {
    const mask = Uint8Array.from([1, 0, 0, 0, 0, 0, 0]);
    expect(orderCandidates(mask, grid, 'compact')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('prefers the middle of the widest gap with spread', () => {
    const mask = Uint8Array.from([0, 0, 1, 0, 0, 0, 0]);
    expect(orderCandidates(mask, grid, 'spread')[0]).toBe(4);
  });

  it('breaks clearance ties by ascending frequency', () => {
    const mask = Uint8Array.from([0, 0, 0, 0, 0, 0, 0]);
    expect(orderCandidates(mask, grid, 'spread')[0]).toBe(3);
    expect(orderCandidates(Uint8Array.from([0, 1, 0, 1, 0, 1, 0]), grid, 'spread')).toEqual([
      0, 2, 4, 6,
    ]);
  });
});
