import { PlusIcon, QrCodeIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { QrPreview } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/server/auth";
import { encodedValue } from "@/server/qr/export";
import { listQrCodes } from "@/server/qr/repository";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const STATUS_VARIANT = { draft: "neutral", active: "success", paused: "warning", archived: "neutral" } as const;

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  await resolveLocale(params);
  const [t, format, user] = await Promise.all([getTranslations("dashboard"), getFormatter(), requireUser()]);
  const codes = await listQrCodes(user.id);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h1">{t("title")}</h1>
        <Button asChild variant="primary">
          <Link href="/create">
            <PlusIcon aria-hidden />
            {t("new")}
          </Link>
        </Button>
      </header>
      {codes.length === 0 ? (
        <Card className="items-center gap-3 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-accent text-accent-foreground">
            <QrCodeIcon aria-hidden className="size-7" />
          </span>
          <h2 className="text-h2">{t("empty.title")}</h2>
          <p className="text-body text-secondary-foreground">{t("empty.text")}</p>
          <Button asChild variant="primary">
            <Link href="/create">{t("empty.cta")}</Link>
          </Button>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {codes.map((qr) => {
            const layout = qr.layouts[0];
            return (
              <li key={qr.id}>
                <Link
                  href={`/dashboard/qr/${qr.id}`}
                  aria-label={t("open", { name: qr.name })}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-1 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-2"
                >
                  <div className="grid aspect-square place-items-center rounded-lg bg-stage p-4">
                    {layout ? (
                      <QrPreview layout={layout.design.layout} value={encodedValue(qr)} label={qr.name} className="size-full" />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="truncate text-h3">{qr.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge variant={STATUS_VARIANT[qr.status]}>{t(`status.${qr.status}`)}</Badge>
                      <Badge variant={qr.model === "dynamic" ? "accent" : "neutral"}>{t(`model.${qr.model}`)}</Badge>
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {t("updated", { date: format.dateTime(qr.updatedAt, { dateStyle: "medium" }) })}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
