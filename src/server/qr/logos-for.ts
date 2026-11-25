import "server-only";
import { newId } from "../db/ids";
import { logoStore } from "../storage/s3";
import { storeLogos } from "./logo-assets";
import type { PrepareRecord } from "./update-layout";

/** HEY-83: uploaded logos of a saved layout go to the account's private storage (inline in dev without storage). */
export function logosFor(userId: string): PrepareRecord | undefined {
  const store = logoStore();
  return store ? (tx, record) => storeLogos(tx, store, userId, record, newId) : undefined;
}
