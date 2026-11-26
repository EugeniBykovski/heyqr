import { ExternalLinkIcon, PencilIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PublishButton } from "@/features/qr-editor";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { CardTitle } from "@/shared/ui/card";

/** QR details for a hosted code: what's live, unpublished changes, Edit page and Publish. */
export async function HostedPageCard({
  qrCodeId,
  status,
  live,
  publicHref,
  date,
  takenDown = false,
}: {
  qrCodeId: string;
  status: { published: { version: number; publishedAt: Date } | null; changed: boolean };
  live: boolean;
  publicHref: string | null;
  date: string;
  /** HEY-182: an operator took the page down after a report; the owner can't publish it back. */
  takenDown?: boolean;
}) {
  const t = await getTranslations("qr.hostedPage");
  return (
    <div data-slot="hosted-page" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        {status.published ? (
          <Badge variant={status.changed ? "warning" : "success"}>
            {status.changed ? t("changed") : t("live", { version: status.published.version })}
          </Badge>
        ) : (
          <Badge>{t("never")}</Badge>
        )}
      </div>
      <p className="text-caption text-secondary-foreground">
        {status.published ? `${t("publishedOn", { date })} · ${status.changed ? t("changedNote") : t("upToDate")}` : t("neverNote")}
      </p>
      {takenDown ? (
        <p role="note" className="rounded-md bg-danger-soft px-3 py-2 text-caption text-danger">
          {t("takenDown")}
        </p>
      ) : !live ? (
        <p className="text-caption text-muted-foreground">{t("notLive")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href={`/dashboard/qr/${qrCodeId}/content`}>
            <PencilIcon aria-hidden />
            {t("edit")}
          </Link>
        </Button>
        {!status.published || status.changed ? <PublishButton qrCodeId={qrCodeId} /> : null}
        {live && !takenDown && status.published && publicHref ? (
          <Button asChild size="sm" variant="ghost">
            <a href={publicHref} target="_blank" rel="noreferrer">
              <ExternalLinkIcon aria-hidden />
              {t("open")}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
