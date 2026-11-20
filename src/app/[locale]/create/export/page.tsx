import { priceSheet } from "@/shared/config/catalog";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { layoutCapacity } from "@heyqr/qr-core";
import { ExportSurface, type ExportFormat } from "@/features/checkout";
import { TooLongNotice } from "@/features/qr-editor";
import { getSession } from "@/server/auth";
import { getCurrency } from "@/server/currency";
import { canDownload, userTrial } from "@/server/billing/entitlements";
import { trialCode } from "@/server/billing/trial";
import { db } from "@/server/db";
import { encodedValue } from "@/server/qr/export";
import { getQrCode, paidPurchase } from "@/server/qr/repository";
import { GuestExport } from "@/widgets/export-screen";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("export");
  return { title: t("title"), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Export settings carried in the URL across sign-in and checkout (design 3.3 / 3.5 / 3.9). */
function settingsFrom(query: Record<string, string | string[] | undefined>) {
  const format = one(query.format);
  const res = Number(one(query.res));
  return {
    format: format === "png" || format === "svg" ? (format as ExportFormat) : undefined,
    resolution: Number.isInteger(res) && res > 0 ? res : undefined,
    transparent: one(query.transparent) === "1",
  };
}

/*
 * Design 3.x "Export". Guests see the export surface for their browser draft and continue with Google; signed-in users
 * see it for a saved code and layout. Entitlement, prices and files stay on the server (canDownload, Stripe, /api/export).
 */
export default async function ExportPage({ params, searchParams }: PageProps<"/[locale]/create/export">) {
  await resolveLocale(params);
  const query = await searchParams;
  const initial = settingsFrom(query);
  const session = await getSession();
  if (!session) return <GuestExport initial={initial} />;

  const qrId = one(query.qr);
  const layoutId = one(query.layout);
  const qr = qrId ? await getQrCode(session.user.id, qrId) : undefined;
  const layout = qr?.layouts.find((l) => l.id === layoutId) ?? qr?.layouts[0];
  if (!qr || !layout) notFound();

  const [t, tTypes, entitled, purchase, phase, testCode] = await Promise.all([
    getTranslations("export"),
    getTranslations("contentTypes"),
    canDownload(session.user.id, qr),
    paidPurchase(session.user.id, qr.id),
    userTrial(session.user.id),
    trialCode(db, session.user.id),
  ]);
  // Design 9.1: a Dynamic code can take the trial's one test slot while the trial runs and the slot is free.
  const canUseTrial =
    qr.model === "dynamic" && (phase.state === "active" || phase.state === "ending") && (!testCode || testCode.id === qr.id);
  const checkout = query.checkout === "success" || query.checkout === "cancelled" ? query.checkout : undefined;
  const value = encodedValue(qr);
  // HEY-24: a code saved before the capacity check could hold more than a QR fits; never offer a broken file.
  const capacity = layoutCapacity(layout.design.layout, value);
  if (!capacity.ok)
    return (
      <main className="mx-auto max-w-measure px-4 py-10 sm:px-6">
        <h1 className="mb-4 text-h1">{t("title")}</h1>
        <TooLongNotice capacity={capacity} />
      </main>
    );

  const keep = new URLSearchParams();
  for (const k of ["format", "res", "transparent"] as const) {
    const v = one(query[k]);
    if (v) keep.set(k, v);
  }
  const hrefFor = (id: string) =>
    `/create/export?${new URLSearchParams({ qr: qr.id, layout: id, ...Object.fromEntries(keep) }).toString()}`;

  const currency = await getCurrency();
  return (
    <ExportSurface
      mode="signed"
      qrCodeId={qr.id}
      layoutId={layout.id}
      entitled={entitled}
      canUseTrial={!entitled && canUseTrial}
      title={entitled ? t("title") : t("titleBuy")}
      heading={`${qr.name} · ${layout.name}`}
      layout={layout.design.layout}
      value={value}
      model={qr.model}
      typeLabel={tTypes(qr.content.type)}
      layoutName={layout.name}
      layouts={qr.layouts.map((l) => ({ id: l.id, name: l.name, href: hrefFor(l.id), active: l.id === layout.id }))}
      backHref={`/edit/${qr.id}?layout=${layout.id}`}
      initial={initial}
      price={{ cents: priceSheet(currency)[qr.model === "dynamic" ? "starter" : "single"] ?? 0, currency }}
      print={
        layout.design.layout.unit === "mm"
          ? { kind: "preview", href: `/print?qr=${qr.id}&layout=${layout.id}&from=export` }
          : { kind: "setup", href: `/edit/${qr.id}?layout=${layout.id}&group=size&next=print` }
      }
      returnedFromSignIn={one(query.signedIn) === "1"}
      checkout={checkout}
      receipt={
        purchase?.paidAt ? { amountCents: purchase.amountTotal, currency: purchase.currency, paidAt: purchase.paidAt.toISOString() } : null
      }
    />
  );
}
