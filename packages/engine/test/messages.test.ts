import { describe, expect, it } from 'vitest';
import { formatViolation } from '../src/messages.js';
import type { Violation, ViolationDetail } from '../src/types.js';

/**
 * The engine emits codes, not prose (D-036). This file is the only place a
 * French sentence is asserted, so the golden files stay language-free and the
 * Kotlin port has numbers to reproduce rather than characters.
 */
const base: Omit<Violation, 'detail' | 'kind'> = {
  severity: 'critical',
  victimLinkId: 'HF01',
  victimFreqKHz: 500_000,
  sourceLinkIds: ['HF02', 'HF03'],
  offenderFreqKHz: 500_150,
  requiredKHz: 200,
  actualKHz: 150,
};

const format = (detail: ViolationDetail, kind: Violation['kind'] = 'im3-2tx'): string =>
  formatViolation({ ...base, kind, detail });

describe('formatViolation', () => {
  it('renders every code of the union', () => {
    const rendered: Record<ViolationDetail['code'], string> = {
      'tuning.outside': format({ code: 'tuning.outside', fromKHz: 470_000, toKHz: 534_000 }, 'out-of-tuning-range'),
      'tuning.off-grid': format({ code: 'tuning.off-grid', fromKHz: 470_000, stepKHz: 25 }, 'out-of-tuning-range'),
      'tuning.hole': format(
        { code: 'tuning.hole', tunableRangesKHz: [[606_000, 607_875], [653_125, 662_875]] },
        'out-of-tuning-range',
      ),
      'band.not-allowed': format({ code: 'band.not-allowed', channelWidthKHz: 200 }, 'out-of-band'),
      'exclusion.too-close': format(
        { code: 'exclusion.too-close', label: 'TNT canal 30', fromKHz: 542_000, toKHz: 550_000 },
        'exclusion',
      ),
      'spacing.too-close': format({ code: 'spacing.too-close' }, 'spacing'),
      'im.too-close': format({ code: 'im.too-close', coefficients: [2, -1] }),
    };
    // Every one says something, in French, naming the link and the megahertz.
    for (const [code, text] of Object.entries(rendered)) {
      expect(text, code).toMatch(/HF0\d/);
      expect(text, code).toMatch(/\d+\.\d{3} MHz/);
      expect(text.length, code).toBeGreaterThan(30);
    }
    expect(new Set(Object.values(rendered)).size, 'deux codes rendent la même phrase').toBe(7);
  });

  it('writes a product as arithmetic a coordinator can redo by hand', () => {
    expect(format({ code: 'im.too-close', coefficients: [2, -1] })).toContain('2×HF02 − HF03');
    expect(format({ code: 'im.too-close', coefficients: [1, 1, -1] })).toContain('HF02 + HF03');
    expect(format({ code: 'im.too-close', coefficients: [3, -2] }, 'im5-2tx')).toContain('IM5 (2 émetteurs)');
  });

  it('measures to the edge of a block, and says so', () => {
    const block = format({ code: 'im.too-close', coefficients: [2, -1], victimBlockHalfWidthKHz: 3_000 });
    expect(block).toContain('du bord du bloc HF01');
    expect(block).toContain('± 3000 kHz');
  });

  it('names the sub-ranges that do tune when a frequency lands in a hole', () => {
    const hole = format(
      { code: 'tuning.hole', tunableRangesKHz: [[606_000, 607_875], [653_125, 662_875]] },
      'out-of-tuning-range',
    );
    expect(hole).toContain('606.000–607.875, 653.125–662.875');
  });
});
