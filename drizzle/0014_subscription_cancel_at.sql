-- HEY-139: when a scheduled cancellation takes effect. Stripe's Customer Portal schedules one with cancel_at (and
-- leaves cancel_at_period_end false). Nullable; existing rows stay null and keep their period end as the end date.
ALTER TABLE "subscription" ADD COLUMN "cancel_at" timestamp with time zone;
