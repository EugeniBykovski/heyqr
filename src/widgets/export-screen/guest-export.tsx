"use client";

import { encodePayload } from "@heyqr/qr-core";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { env } from "@/env";
import { previewShortLink } from "@/shared/lib/short-link";
import { contentDisplayName, designToLayout, type EditorDesign } from "@/entities/qr";
import { GoogleSignInButton, type SignInError } from "@/features/auth";
import { ExportSurface, settingsQuery, type ExportFormat } from "@/features/checkout";
import { readDraft } from "@/features/qr-editor";
import { Link } from "@/i18n/navigation";
import { usePrices } from "@/shared/lib/currency";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

/*
 * Design 3.1 "Export · guest": the same export surface, built from this browser's draft. A guest sees the exact layout,
 * file and price, and one action: Continue with Google, which starts Google sign-in directly (3.2). The chosen format,
 * PNG size and transparency travel with it: on success to /create?resume=1&format=…, where the draft is saved once and
 * the signed-in export screen opens with the same settings (3.3); on a cancel back to this screen with the same settings
 * and a notice, so the same button retries (HEY-76). Nothing here is saved or charged before sign-in.
 */
export function GuestExport({
  initial,
  signInNotice,
  support = null,
}: {
  initial: { format?: ExportFormat; resolution?: number; transparent?: boolean };
  signInNotice?: SignInError;
  /** HEY-109: the confirmed support contact, from the server. */
  support?: string | null;
}) {
  const locale = useLocale();
  const local = (path: string) => (locale === "en" ? path : `/${locale}${path}`);
  const t = useTranslations("export");
  const tEditor = useTranslations("editor");
  const tTypes = useTranslations("contentTypes");
  const prices = usePrices();
  const [draft, setDraft] = useState<EditorDesign | null | undefined>(undefined);
  // The draft lives in this browser only; it is read after mount so the server render matches.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only storage after hydration
  useEffect(() => setDraft(readDraft()), []);

  if (draft === undefined)
    return (
      <main aria-busy className="mx-auto grid w-full max-w-wide gap-6 px-4 pt-14 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:px-8">
        <Skeleton className="aspect-square w-full rounded-xl lg:aspect-[4/3]" />
        <Skeleton className="h-120 w-full rounded-2xl" />
      </main>
    );
  if (!draft)
    return (
      <main className="mx-auto flex max-w-measure flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="text-h1">{t("emptyTitle")}</h1>
        <p className="text-secondary-foreground">{t("emptyText")}</p>
        <Button asChild variant="primary">
          <Link href="/create">{t("emptyAction")}</Link>
        </Button>
      </main>
    );

  const layout = designToLayout(draft);
  const value = draft.model === "dynamic" ? previewShortLink(env.NEXT_PUBLIC_SHORT_LINK_BASE) : encodePayload(draft.content);
  const name = draft.name.trim() || contentDisplayName(draft.content) || tEditor("namePlaceholder");
  return (
    <ExportSurface
      mode="guest"
      support={support}
      title={t("titleGuest")}
      heading={name}
      layout={layout}
      value={value}
      model={draft.model}
      shortLinkPreview={draft.model === "dynamic"}
      typeLabel={tTypes(draft.content.type)}
      layoutName={tEditor(`presets.${draft.preset}`)}
      backHref="/create?step=design"
      initial={initial}
      price={{ cents: (draft.model === "dynamic" ? prices.cents.starter : prices.cents.single) ?? 0, currency: prices.currency }}
      signInNotice={signInNotice}
      signInAction={(s) => (
        <GoogleSignInButton
          variant="primary"
          callbackURL={local(`/create?resume=1&${settingsQuery(s)}`)}
          errorCallbackURL={local(`/create/export?${settingsQuery(s)}`)}
        />
      )}
    />
  );
}
