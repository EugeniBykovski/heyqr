/**
 * HEY-62: a small least-recently-used cache for pure, deterministic results (the QR matrix of a value, a caption's
 * fitted lines). The live editor recomputes a design on every keystroke or slider step; most of those inputs repeat
 * (the same payload while only a colour changes, the same caption while only the code size changes). Cached results
 * are shared, so callers must treat them as read-only, as they already do.
 */
export function lru<T>(limit: number) {
  const map = new Map<string, T>();
  return (key: string, make: () => T): T => {
    const hit = map.get(key);
    if (hit !== undefined) {
      map.delete(key);
      map.set(key, hit);
      return hit;
    }
    const value = make();
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value as string);
    return value;
  };
}
