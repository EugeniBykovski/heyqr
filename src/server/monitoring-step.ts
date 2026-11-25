/*
 * HEY-175: names the step that failed inside an operation (`stripe.session_create`, `storage.put`, …). Server bundles
 * are minified, so the stack alone doesn't say. Plain module without dependencies; the same error is rethrown.
 */
const STEP = Symbol.for("heyqr.monitoring.step");

/** Runs one step; if it fails, the error remembers the innermost step's name and continues unchanged. */
export async function step<T>(name: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    try {
      if (typeof error === "object" && error !== null && Object.isExtensible(error) && stepOf(error) === undefined)
        Object.defineProperty(error, STEP, { value: name });
    } catch {
      // The step's name is a convenience; the error itself is what matters.
    }
    throw error;
  }
}

export function stepOf(error: unknown): string | undefined {
  const name = typeof error === "object" && error !== null ? (error as Record<symbol, unknown>)[STEP] : undefined;
  return typeof name === "string" ? name : undefined;
}
