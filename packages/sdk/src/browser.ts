import { HeyQrError } from "./shared.js";

/*
 * HEY-168 / QR-23.02: what a browser bundle gets for `import … from "@heyqr/sdk"` (the package's `browser` export
 * condition, used by Vite, webpack, Next.js client components and other bundlers). It has the same runtime exports as
 * the server entry (error classes, type guards, constants, helpers), but no API client: no transport, no
 * authentication, no key handling. Constructing `HeyQrClient` here throws a clear HeyQrError (kind "server_only"),
 * because an API key must never reach a browser. For previews in the browser, use "@heyqr/sdk/react".
 */
export {
  DEFAULT_TIMEOUT_MS,
  dispositionFilename,
  HeyQrAbortError,
  HeyQrApiError,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isIdempotencyConflict,
  isPaymentRequired,
  isRevisionConflict,
  isTimeout,
  newIdempotencyKey,
  retryAfter,
} from "./shared.js";

const SERVER_ONLY_MESSAGE =
  'HeyQrClient from "@heyqr/sdk" runs on a server only: an API key must never be sent to a browser. Call your own server from the browser, and use "@heyqr/sdk/react" for QR previews.';

/** The browser stand-in for the server client: constructing it always throws (kind "server_only"). */
export class HeyQrClient {
  /** Same signature as the server client; it always throws here. */
  constructor(options?: unknown) {
    void options;
    throw new HeyQrError(SERVER_ONLY_MESSAGE, undefined, "server_only");
  }
}
