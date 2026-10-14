import { describe, expect, it } from 'vitest';
import { qrMatrix } from '../src/ui/qr';

const version = (text: string) => (qrMatrix(text).length - 17) / 4;

describe('qrMatrix', () => {
  it('picks the smallest version that holds the bytes at level M', () => {
    // Byte-mode capacities from ISO/IEC 18004, table 7.
    expect(version('x'.repeat(14))).toBe(1);
    expect(version('x'.repeat(15))).toBe(2);
    expect(version('x'.repeat(26))).toBe(2);
    expect(version('x'.repeat(27))).toBe(3);
    expect(version('x'.repeat(213))).toBe(10);
    expect(version('x'.repeat(214))).toBe(11);
    expect(version('x'.repeat(2331))).toBe(40);
    expect(() => qrMatrix('x'.repeat(2332))).toThrow(RangeError);
  });

  it('counts umlauts as the two bytes UTF-8 makes of them', () => {
    expect(version('ü'.repeat(7))).toBe(1);
    expect(version('ü'.repeat(8))).toBe(2);
  });

  it('draws the three finder patterns and the timing lines', () => {
    const m = qrMatrix('https://stammbaum.example/#/p/klaus');
    const size = m.length;
    const finderRow = [true, true, true, true, true, true, true, false];
    expect(m[0]!.slice(0, 8)).toEqual(finderRow);
    expect(m[0]!.slice(size - 8).reverse()).toEqual(finderRow);
    expect(m[size - 1]!.slice(0, 8)).toEqual(finderRow);
    for (let i = 8; i < size - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    // The dark module beside the bottom-left finder is always there.
    expect(m[size - 8]![8]).toBe(true);
  });
});
