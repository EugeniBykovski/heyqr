/**
 * Reads what caption tests and the metrics generator need from a TrueType file: the mapped code points (cmap formats
 * 4 and 12) with their glyphs, each code point's advance width (hmtx), units per em, family and weight.
 */
export function readTtf(buf: Uint8Array): {
  codePoints: Set<number>;
  advances: Map<number, number>;
  unitsPerEm: number;
  family: string;
  weight: number;
} {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0, n = v.getUint16(4); i < n; i++) {
    const r = 12 + i * 16;
    tables.set(String.fromCharCode(buf[r] ?? 0, buf[r + 1] ?? 0, buf[r + 2] ?? 0, buf[r + 3] ?? 0), v.getUint32(r + 8));
  }
  const cmap = tables.get("cmap") ?? 0;
  const codePoints = new Set<number>();
  const glyphOf = new Map<number, number>();
  for (let i = 0, n = v.getUint16(cmap + 2); i < n; i++) {
    const sub = cmap + v.getUint32(cmap + 4 + i * 8 + 4);
    const format = v.getUint16(sub);
    if (format === 4) {
      const segX2 = v.getUint16(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2);
        const start = v.getUint16(starts + s * 2);
        const delta = v.getInt16(deltas + s * 2);
        const ro = v.getUint16(offsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = ro === 0 ? (c + delta) & 0xffff : v.getUint16(offsets + s * 2 + ro + (c - start) * 2);
          if (glyph !== 0) {
            codePoints.add(c);
            glyphOf.set(c, glyph);
          }
        }
      }
    } else if (format === 12) {
      for (let g = 0, groups = v.getUint32(sub + 12); g < groups; g++) {
        const r = sub + 16 + g * 12;
        for (let c = v.getUint32(r), g0 = v.getUint32(r + 8); c <= v.getUint32(r + 4); c++) {
          codePoints.add(c);
          glyphOf.set(c, g0 + (c - v.getUint32(r)));
        }
      }
    }
  }
  const name = tables.get("name") ?? 0;
  const strings = name + v.getUint16(name + 4);
  const names = new Map<number, string>();
  for (let i = 0, n = v.getUint16(name + 2); i < n; i++) {
    const r = name + 6 + i * 12;
    if (v.getUint16(r) !== 3) continue; // Windows, UTF-16BE
    let s = "";
    for (let k = 0; k < v.getUint16(r + 8); k += 2) s += String.fromCharCode(v.getUint16(strings + v.getUint16(r + 10) + k));
    names.set(v.getUint16(r + 6), s);
  }
  const os2 = tables.get("OS/2") ?? 0;
  const unitsPerEm = v.getUint16((tables.get("head") ?? 0) + 18);
  const metricsCount = v.getUint16((tables.get("hhea") ?? 0) + 34);
  const hmtx = tables.get("hmtx") ?? 0;
  const advanceOf = (glyph: number) => v.getUint16(hmtx + Math.min(glyph, metricsCount - 1) * 4);
  const advances = new Map([...glyphOf].map(([c, glyph]) => [c, advanceOf(glyph)]));
  return { codePoints, advances, unitsPerEm, family: names.get(16) ?? names.get(1) ?? "", weight: v.getUint16(os2 + 4) };
}
