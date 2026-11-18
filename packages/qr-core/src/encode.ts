/**
 * QR Code encoder (ISO/IEC 18004), byte mode, versions 1–20.
 * Ported from the HeyQR design prototype. Besides the module matrix it keeps
 * the bookkeeping the scan check needs: which modules are function patterns
 * and which codeword (and error-correction block) every data module belongs to.
 */

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** Modules per side (version * 4 + 17). */
  size: number;
  version: number;
  ecl: ErrorCorrectionLevel;
  /** modules[y][x] — true = dark. */
  modules: boolean[][];
  /** functionModules[y][x] — finder, timing, alignment, format and version areas. */
  functionModules: boolean[][];
  /** codewordAt[y][x] — index of the interleaved codeword stored in this module, -1 for none. */
  codewordAt: number[][];
  /** codewordBlock[i] — error-correction block of interleaved codeword i. */
  codewordBlock: number[];
  /** Error-correction codewords per block. */
  eccPerBlock: number;
  blockCount: number;
  mask: number;
}

const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
];
/** [ordinal, format bits] */
const ECL_INFO: Record<ErrorCorrectionLevel, [number, number]> = {
  L: [0, 1],
  M: [1, 0],
  Q: [2, 3],
  H: [3, 2],
};

export const MAX_VERSION = 20;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
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

function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Smallest version whose capacity fits `byteLength` bytes at `ecl`, or 0 if none up to MAX_VERSION. */
export function pickVersion(byteLength: number, ecl: ErrorCorrectionLevel): number {
  const ei = ECL_INFO[ecl][0];
  for (let v = 1; v <= MAX_VERSION; v++) {
    const capacityBits = (Math.floor(rawDataModules(v) / 8) - ECC_CODEWORDS_PER_BLOCK[ei][v] * NUM_ERROR_CORRECTION_BLOCKS[ei][v]) * 8;
    if (4 + (v < 10 ? 8 : 16) + byteLength * 8 <= capacityBits) return v;
  }
  return 0;
}

/** Largest payload, in UTF-8 bytes, that fits at `ecl` within MAX_VERSION (byte mode, 16-bit length field). */
export function maxPayloadBytes(ecl: ErrorCorrectionLevel): number {
  const ei = ECL_INFO[ecl][0];
  const v = MAX_VERSION;
  const capacityBits = (Math.floor(rawDataModules(v) / 8) - ECC_CODEWORDS_PER_BLOCK[ei][v] * NUM_ERROR_CORRECTION_BLOCKS[ei][v]) * 8;
  return Math.floor((capacityBits - 4 - 16) / 8);
}

/** Size of the payload as the encoder sees it: UTF-8 bytes of the final serialized string. */
export function payloadBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Thrown only when the data doesn't fit; carries sizes, never the content. */
export class QrCapacityError extends Error {
  constructor(
    public readonly byteLength: number,
    public readonly maxBytes?: number,
  ) {
    super(`Content is too long for a QR code (${byteLength} bytes${maxBytes === undefined ? "" : ` of ${maxBytes}`}).`);
    this.name = "QrCapacityError";
  }
}

export function encodeQr(text: string, ecl: ErrorCorrectionLevel = "M"): QrMatrix {
  const [ei, formatEcl] = ECL_INFO[ecl];
  const bytes = Array.from(new TextEncoder().encode(text));
  const ver = pickVersion(bytes.length, ecl);
  if (!ver) throw new QrCapacityError(bytes.length, maxPayloadBytes(ecl));

  const capacityBits = (Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ei][ver] * NUM_ERROR_CORRECTION_BLOCKS[ei][ver]) * 8;
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacityBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    data.push(b);
  }

  // Split into blocks, add error correction, interleave.
  const blockCount = NUM_ERROR_CORRECTION_BLOCKS[ei][ver];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ei][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = blockCount - (rawCodewords % blockCount);
  const shortBlockLen = Math.floor(rawCodewords / blockCount);
  const divisor = reedSolomonDivisor(eccPerBlock);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccPerBlock + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  const codewordBlock: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - eccPerBlock || j >= numShortBlocks) {
        codewords.push(block[i]);
        codewordBlock.push(j);
      }
    });
  }

  const size = ver * 4 + 17;
  const grid = <T>(v: T): T[][] => Array.from({ length: size }, () => new Array<T>(size).fill(v));
  const modules = grid(false);
  const fn = grid(false);
  const codewordAt = grid(-1);
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    fn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  const na = align.length;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFunction(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormatBits = (mask: number) => {
    const fmt = (formatEcl << 3) | mask;
    let rem = fmt;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((fmt << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fbits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i));
    setFunction(8, size - 8, true);
  };
  drawFormatBits(0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vbits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  }

  // Zigzag codeword placement.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bitIndex < totalBits) {
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          codewordAt[y][x] = bitIndex >>> 3;
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskBit(mask, x, y)) modules[y][x] = !modules[y][x];
  };
  const penalty = (): number => {
    let p = 0;
    let dark = 0;
    for (let y = 0; y < size; y++) {
      let rowColor: boolean | null = null;
      let rowRun = 0;
      let colColor: boolean | null = null;
      let colRun = 0;
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === rowColor) {
          rowRun++;
          if (rowRun === 5) p += 3;
          else if (rowRun > 5) p++;
        } else {
          rowColor = modules[y][x];
          rowRun = 1;
        }
        if (modules[x][y] === colColor) {
          colRun++;
          if (colRun === 5) p += 3;
          else if (colRun > 5) p++;
        } else {
          colColor = modules[x][y];
          colRun = 1;
        }
        if (modules[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3;
        }
      }
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return p + Math.max(0, k) * 10;
  };

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormatBits(m);
    const score = penalty();
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = m;
    }
    applyMask(m);
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return { size, version: ver, ecl, modules, functionModules: fn, codewordAt, codewordBlock, eccPerBlock, blockCount, mask: bestMask };
}
