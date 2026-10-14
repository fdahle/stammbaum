/**
 * A QR code encoder — byte mode, error correction level M, versions 1 to 40 —
 * written out here because the app carries no runtime dependencies. It
 * follows ISO/IEC 18004 in the shape of Project Nayuki's reference encoder:
 * data bits, Reed–Solomon blocks, function patterns, the zigzag placement and
 * the mask with the lowest penalty.
 */

/** Rows of modules, `true` for dark, without the quiet zone around them. */
export type QrMatrix = boolean[][];

/** Error correction codewords per block, by version — level M. */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

/** Error correction blocks, by version — level M. */
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
  33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Level M is written as 00 in the format bits. */
const LEVEL_BITS = 0;

export function qrMatrix(text: string): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  const version = fittingVersion(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);
  const symbol = new QrSymbol(version);
  symbol.place(codewords);

  let best: { mask: number; penalty: number } | undefined;
  for (let mask = 0; mask < 8; mask++) {
    symbol.apply(mask);
    symbol.formatBits(mask);
    const penalty = symbol.penalty();
    if (!best || penalty < best.penalty) best = { mask, penalty };
    symbol.apply(mask); // XOR again to undo
  }
  symbol.apply(best!.mask);
  symbol.formatBits(best!.mask);
  return symbol.modules;
}

// ---- data -----------------------------------------------------------------

function fittingVersion(length: number): number {
  for (let version = 1; version <= 40; version++) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + length * 8 <= dataCapacity(version) * 8) return version;
  }
  throw new RangeError('too long for a QR code');
}

/** Mode, length, the bytes, a terminator and the alternating pad bytes. */
function dataCodewords(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);

  const capacity = dataCapacity(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return codewords;
}

/** Splits the data into blocks, adds each block's error correction and interleaves them. */
function interleave(data: number[], version: number): number[] {
  const blocks = BLOCKS[version]!;
  const eccLength = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);

  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const chunk = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += chunk.length;
    const ecc = rsRemainder(chunk, divisor);
    // A placeholder keeps short and long blocks the same length for the interleave.
    if (i < shortBlocks) chunk.push(0);
    all.push([...chunk, ...ecc]);
  }

  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

function dataCapacity(version: number): number {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version]! * BLOCKS[version]!;
}

/** Modules left for data and error correction once the function patterns are drawn. */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

// ---- Reed–Solomon over GF(2^8) ---------------------------------------------

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i]! ^= gfMultiply(coefficient, factor)));
  }
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

// ---- the symbol -------------------------------------------------------------

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  /** Finder, timing, alignment, format and version modules — never masked. */
  private readonly fixed: boolean[][];

  constructor(private readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = grid(this.size);
    this.fixed = grid(this.size);
    this.drawFunctionPatterns();
  }

  /** Lays the codewords in two-module columns, zigzagging up and down from the right. */
  place(codewords: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // The vertical timing pattern takes column 6.
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.fixed[y]![x] && i < codewords.length * 8) {
            this.modules[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  /** Flips the data modules where `mask` says so — applying it twice undoes it. */
  apply(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.fixed[y]![x] && MASKS[mask]!(x, y)) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  formatBits(mask: number): void {
    const data = (LEVEL_BITS << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true);
  }

  /** ISO 18004's four penalty rules: runs, blocks, finder look-alikes, balance. */
  penalty(): number {
    let result = 0;
    const lines: boolean[][] = [];
    for (let i = 0; i < this.size; i++) {
      lines.push(this.modules[i]!);
      lines.push(this.modules.map((row) => row[i]!));
    }
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) result += run - 2;
          run = 1;
        }
      }
      const text = line.map((dark) => (dark ? '1' : '0')).join('');
      for (const pattern of ['10111010000', '00001011101']) {
        for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) result += 40;
      }
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const dark = this.modules[y]![x];
        if (dark === this.modules[y]![x + 1] && dark === this.modules[y + 1]![x] && dark === this.modules[y + 1]![x + 1]) {
          result += 3;
        }
      }
    }
    const dark = this.modules.flat().filter(Boolean).length;
    const total = this.size * this.size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);

    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((x, i) =>
      positions.forEach((y, j) => {
        // Not where a finder pattern already sits.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }),
    );

    this.formatBits(0); // Reserves the area; the real mask is drawn later.
    if (this.version >= 7) {
      let remainder = this.version;
      for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
      const bits = (this.version << 12) | remainder;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = this.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }

  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.fixed[y]![x] = true;
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function grid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

// ---- drawing ----------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The code as one SVG path, with the four-module quiet zone scanners need. */
export function qrSvg(text: string): SVGSVGElement {
  const matrix = qrMatrix(text);
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  const d: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }),
  );
  path.setAttribute('d', d.join(''));
  path.setAttribute('fill', '#000');
  svg.append(background, path);
  return svg;
}
