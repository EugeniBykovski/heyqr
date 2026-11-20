import { composeLayout, type Layout } from "@heyqr/qr-core";

type Composed = ReturnType<typeof composeLayout>;
const cache = new WeakMap<Layout, Map<string, Composed>>();

/*
 * HEY-62: one composition per shown design. The canvas (QrPreview), its scan check and the save gate all need
 * composeLayout for the same layout object and value; they now share one result instead of composing the code two or
 * three times per change. Layouts are immutable values (designToLayout makes a new one for every change), so the
 * layout object itself is the key; entries go with the layout (WeakMap).
 */
export function composeShared(layout: Layout, value: string, options: { transparent?: boolean } = {}): Composed {
  const key = `${options.transparent ? 1 : 0}\u0000${value}`;
  let byValue = cache.get(layout);
  if (!byValue) {
    byValue = new Map();
    cache.set(layout, byValue);
  }
  const hit = byValue.get(key);
  if (hit) return hit;
  const composed = composeLayout(layout, value, options);
  byValue.set(key, composed);
  return composed;
}
