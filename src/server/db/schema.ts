import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { QrContent } from "@heyqr/qr-core";
import type { LayoutRecordDesign } from "../../entities/qr/model/design-schema";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ───────────── Better Auth (users, sessions, OAuth accounts) ───────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  locale: text("locale"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  /** Design 9.x Starter trial: set once when the trial starts (no card, no automatic charge). */
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/* ───────────── Product ───────────── */

export const qrModel = pgEnum("qr_model", ["static", "dynamic"]);
export const qrStatus = pgEnum("qr_status", ["draft", "active", "paused", "archived"]);
export const purchaseStatus = pgEnum("purchase_status", ["pending", "paid", "refunded", "failed"]);
export const exportFormat = pgEnum("export_format", ["png", "svg", "pdf"]);

/** A QR code: what it encodes. Design lives in its layouts. */
export const qrCode = pgTable(
  "qr_code",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: jsonb("content").$type<QrContent>().notNull(),
    model: qrModel("model").notNull().default("static"),
    status: qrStatus("status").notNull().default("draft"),
    /** Dynamic codes only: permanent slug printed in the code. */
    shortCode: text("short_code").unique(),
    /** Dynamic codes only: where the short link redirects; editable after printing. */
    destination: text("destination"),
    /** The destination before the most recent change (HEY-123; full history is HEY-125). */
    previousDestination: text("previous_destination"),
    /** HEY-123: when the destination last changed, set by the server in the same write. Null for older rows. */
    destinationChangedAt: timestamp("destination_changed_at", { withTimezone: true }),
    /**
     * HEY-128: the destination's own revision, advanced by each actual destination change (never by design saves or
     * other edits). Change destination sends the revision it opened with; a save from an older one is a conflict.
     */
    destinationRevision: integer("destination_revision").notNull().default(0),
    /** Set when a static code is bought. Every layout and format is then included. */
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
    /** Soft delete: hidden everywhere and the short link stops; cleared again by Undo. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** The trial's one test Dynamic code: its short link redirects while the trial runs or a plan is active. */
    isTrial: boolean("is_trial").notNull().default(false),
    /** Design 8.x Print Pack: set when the Print Pack of this code is bought (print PDF, editable SVG, specifications). */
    printPackAt: timestamp("print_pack_at", { withTimezone: true }),
    /**
     * HEY-77: the random key of the browser draft this code was saved from (kept in that browser until the save
     * succeeds). Saving the same draft again for the same account returns this code instead of a duplicate.
     */
    guestClaimKey: text("guest_claim_key"),
    ...timestamps,
  },
  (t) => [
    index("qr_code_user_idx").on(t.userId, t.updatedAt),
    uniqueIndex("qr_code_guest_claim_uq")
      .on(t.userId, t.guestClaimKey)
      .where(sql`${t.guestClaimKey} is not null and ${t.deletedAt} is null`),
  ],
);

/** A named design of a QR code (Business card, Poster…). One QR has many layouts. */
export const qrLayout = pgTable(
  "qr_layout",
  {
    id: text("id").primaryKey(),
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Versioned design record (schemaVersion, layout, editor settings); read it through readLayoutRecord. */
    design: jsonb("design").$type<LayoutRecordDesign>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("qr_layout_qr_idx").on(t.qrCodeId, t.sortOrder)],
);

/**
 * HEY-125: one row per actual destination change of a Dynamic code, written by changeDestination in the same transaction
 * (and with the same server time) as the change itself. The first destination, set when the code is created, has no
 * row; neither has a save of the same address. Older changes made before this table existed have no rows: only their
 * last change is known (qr_code.previous_destination / destination_changed_at, HEY-123).
 */
export const destinationChange = pgTable(
  "destination_change",
  {
    /** Increasing: orders changes that share a timestamp. */
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    previousUrl: text("previous_url"),
    newUrl: text("new_url").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("destination_change_qr_idx").on(t.qrCodeId, t.changedAt.desc(), t.id.desc())],
);

/**
 * HEY-126: every short link ever issued, so a slug never goes to another code, even after its code or account is gone.
 * Only the slug is kept (no reference to the code, account or destination), so the reservation outlives both.
 * Written only by PostgreSQL (migration 0012): a trigger on qr_code reserves the slug in the same statement that inserts
 * a code with one or assigns one for the first time. Append-only: updates, deletes and truncation are refused.
 */
export const shortCodeReservation = pgTable("short_code_reservation", {
  shortCode: text("short_code").primaryKey(),
});

/** One-time purchase of a static code. */
export const purchase = pgTable(
  "purchase",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The code it is for; empty for Static Packs (credits are the account's). */
    qrCodeId: text("qr_code_id").references(() => qrCode.id, { onDelete: "cascade" }),
    /** What was bought: a static code (with or without its Print Pack), a Print Pack add-on, or a Static Pack. */
    item: text("item").$type<PurchaseItem>().notNull().default("single_qr"),
    /** Design 7.3 / 7.4 itemized receipt: the lines charged, in this purchase's currency (minor units). */
    lines: jsonb("lines").$type<PurchaseLine[]>(),
    /**
     * The Checkout Session of the order's current attempt. HEY-88: a Single QR order exists (pending) before Stripe is
     * called, so it is empty until the first session is attached, and stays retryable if creating one fails.
     */
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    amountTotal: integer("amount_total").notNull(),
    currency: text("currency").notNull(),
    status: purchaseStatus("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("purchase_user_idx").on(t.userId)],
);

export type PurchaseItem = "single_qr" | "single_qr_print_pack" | "print_pack" | "pack3" | "pack10";
export type PurchaseLine = { offer: "single" | "printPack" | "pack3" | "pack10"; amount: number };

/**
 * Design 4.8 Static Packs: the account's static credits. +n when a pack is paid, −1 when a credit unlocks a static code.
 * The balance is the sum; a credit spend references the code it unlocked (one per code).
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** pack3 / pack10: a pack's credits (+); unlock: one spent on a code (−1); refund: a refunded pack's unused credits (−). */
    reason: text("reason").$type<"pack3" | "pack10" | "unlock" | "refund">().notNull(),
    purchaseId: text("purchase_id").references(() => purchase.id, { onDelete: "set null" }),
    qrCodeId: text("qr_code_id").references(() => qrCode.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_ledger_user_idx").on(t.userId),
    // A pack's credits once per purchase, and its refund removal once (HEY-100).
    uniqueIndex("credit_ledger_purchase_uq")
      .on(t.purchaseId)
      .where(sql`${t.reason} in ('pack3', 'pack10')`),
    uniqueIndex("credit_ledger_refund_uq")
      .on(t.purchaseId)
      .where(sql`${t.reason} = 'refund'`),
    // One credit per code: a code can't be unlocked with credits twice.
    uniqueIndex("credit_ledger_unlock_uq")
      .on(t.qrCodeId)
      .where(sql`${t.reason} = 'unlock'`),
  ],
);

/**
 * HEY-100: one Stripe refund (its id), applied once. `lines` are the order lines it refunds in full (by offer), from an
 * explicit allocation or a full refund of what's left; `outcome` is applied (entitlements changed accordingly) or
 * review (recorded, nothing changed: ambiguous or inconsistent, see `reason`).
 */
export const refund = pgTable(
  "refund",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id").references(() => purchase.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    lines: jsonb("lines").$type<PurchaseLine["offer"][]>(),
    outcome: text("outcome").$type<"applied" | "review">().notNull(),
    reason: text("reason"),
    creditsRemoved: integer("credits_removed").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refund_purchase_idx").on(t.purchaseId)],
);

/**
 * Design 4.8 monthly allowances of a plan: a static unlock or an included Print Pack, used in a billing period.
 * Counted per period start, so allowances reset with the plan's renewal and unused ones don't roll over.
 */
export const allowanceUse = pgTable(
  "allowance_use",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"static_unlock" | "print_pack">().notNull(),
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("allowance_use_user_idx").on(t.userId, t.kind, t.periodStart), uniqueIndex("allowance_use_code_uq").on(t.kind, t.qrCodeId)],
);

/** Dynamic plan subscription (mirrors Stripe; Stripe is the source of truth). */
export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripePriceId: text("stripe_price_id").notNull(),
    status: text("status").notNull(),
    activeCodeLimit: integer("active_code_limit").notNull(),
    /** Design 4.8 plans: Starter or Studio (monthly allowances and Dynamic slots). */
    plan: text("plan").$type<"starter" | "studio">().notNull().default("starter"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("subscription_user_idx").on(t.userId)],
);

/** Daily scan counters for dynamic codes (incremented by the redirect route). */
export const scanDaily = pgTable(
  "scan_daily",
  {
    qrCodeId: text("qr_code_id")
      .notNull()
      .references(() => qrCode.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.qrCodeId, t.day] })],
);

/** Uploaded logos and images (stored in S3). */
/**
 * HEY-83: an uploaded logo kept in private object storage (R2 / S3 / MinIO) under `storageKey`. Saved layouts refer to
 * it as `asset:<id>`, never by URL; it is read only through its owner's saved layouts. `sha256` lets every layout of an
 * account that uses the same file share one object; `lastUsedAt` is touched on every save that references it, and an
 * asset that no saved layout references is removed by cleanup once it hasn't been used for a while.
 */
export const asset = pgTable(
  "asset",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("asset_user_sha_uq")
      .on(t.userId, t.sha256)
      .where(sql`${t.sha256} is not null`),
  ],
);

/** Cache of rendered export files, keyed by a hash of the design + format + size. */
export const exportFile = pgTable(
  "export_file",
  {
    id: text("id").primaryKey(),
    layoutId: text("layout_id")
      .notNull()
      .references(() => qrLayout.id, { onDelete: "cascade" }),
    format: exportFormat("format").notNull(),
    pixelWidth: integer("pixel_width"),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("export_file_hash_idx").on(t.layoutId, t.format, t.contentHash)],
);

/** Processed Stripe webhook events, for idempotency. */
export const webhookEvent = pgTable("webhook_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/* ───────────── Relations ───────────── */

export const userRelations = relations(user, ({ many }) => ({
  qrCodes: many(qrCode),
  purchases: many(purchase),
  subscriptions: many(subscription),
}));

export const qrCodeRelations = relations(qrCode, ({ one, many }) => ({
  owner: one(user, { fields: [qrCode.userId], references: [user.id] }),
  layouts: many(qrLayout),
  purchases: many(purchase),
  scans: many(scanDaily),
}));

export const qrLayoutRelations = relations(qrLayout, ({ one }) => ({
  qrCode: one(qrCode, { fields: [qrLayout.qrCodeId], references: [qrCode.id] }),
}));

export const purchaseRelations = relations(purchase, ({ one }) => ({
  qrCode: one(qrCode, { fields: [purchase.qrCodeId], references: [qrCode.id] }),
  user: one(user, { fields: [purchase.userId], references: [user.id] }),
}));

export const scanDailyRelations = relations(scanDaily, ({ one }) => ({
  qrCode: one(qrCode, { fields: [scanDaily.qrCodeId], references: [qrCode.id] }),
}));
