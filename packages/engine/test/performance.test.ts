import { describe, expect, it } from 'vitest';
import { coordinate } from '../src/assign.js';
import { FR_BANDS, link } from './fixtures/links.js';

/**
 * The build brief sets the budget: 40 links, IM3 3-tx and IM5 2-tx enabled,
 * under 3 s in the browser. It is asserted on an uninstrumented run — V8
 * coverage roughly triples the cost of the inner blocking loops — so
 * `pnpm coverage` excludes this file. `pnpm test` does not.
 */
describe('coordinate — performance budget', () => {
  it('coordinates 40 links with IM3 3-tx and IM5 2-tx in under 3 s', () => {
    const links = Array.from({ length: 40 }, (_, i) =>
      link(`HF${String(i + 1).padStart(2, '0')}`, { tuningRangeKHz: [470_000, 694_000] }),
    );
    const started = Date.now();
    const result = coordinate({ links, bands: FR_BANDS });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
  });
});
