import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CreateApiKey } from "@/features/api-keys";
import { resolveLocale } from "@/i18n/server";
import { listApiKeys } from "@/server/api-keys/keys";
import { db } from "@/server/db";
import { requireAccount } from "../../require-account";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiKeys");
  return { title: t("title"), robots: { index: false } };
}

const card = "flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-6";

/*
 * HEY-153 / QR-21.01: the account's API keys. Each key belongs to this account only. The page lists safe metadata
 * (prefix, creation date); a new key's full value is shown once by CreateApiKey and never rendered here.
 */
export default async function ApiKeysPage({ params, searchParams }: PageProps<"/[locale]/dashboard/api-keys">) {
  const locale = await resolveLocale(params);
  const user = await requireAccount(locale, "/dashboard/api-keys", await searchParams);
  const [t, format, keys] = await Promise.all([getTranslations("apiKeys"), getFormatter(), listApiKeys(db, user.id)]);
  return (
    <div className="mx-auto flex w-full max-w-190 flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-h1">{t("title")}</h1>
        <p className="text-secondary-foreground">{t("lead")}</p>
      </header>
      <section aria-labelledby="api-keys-list" className={card}>
        <h2 id="api-keys-list" className="text-h3">
          {t("yourKeys")}
        </h2>
        <CreateApiKey />
        {keys.length === 0 ? (
          <p className="text-secondary-foreground">{t("none")}</p>
        ) : (
          <ul data-slot="api-key-list" className="flex flex-col divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <code className="font-mono text-[0.875rem]">{k.prefix}…</code>
                <span className="text-caption text-muted-foreground">
                  {t("created", { date: format.dateTime(new Date(k.createdAt), { dateStyle: "medium" }) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
