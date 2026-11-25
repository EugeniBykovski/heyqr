import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DESIGN, designToLayout, QrPreview } from "@/entities/qr";
import { HostedPage } from "@/entities/hosted-page";
import { env } from "@/env";
import { resolveShortLink } from "@/server/billing/access";
import { db } from "@/server/db";
import { publicHostedContent } from "@/server/qr/hosted";
import { deviceFromUserAgent } from "@/server/qr/hosted-device";
import { shortLinkUrl } from "@/shared/lib/short-link";
import { applyVisitorLocale } from "../locale";
import { HostedShell } from "./shell";
import { Unavailable } from "./unavailable";

/*
 * Design 11.0: the public page of a hosted QR code, reached through its short link (/r/<code> counts the scan and
 * redirects here). Anonymous: only the latest published version, only while the code is live; drafts never show.
 * Never cached, so publishing, a pause or a plan ending shows on the very next visit.
 */
export const dynamic = "force-dynamic";

async function load(code: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return null;
  const answer = await resolveShortLink(db, code);
  return answer.kind === "hosted" ? answer : null;
}

export async function generateMetadata({ params }: PageProps<"/p/[code]">): Promise<Metadata> {
  const { code } = await params;
  await applyVisitorLocale();
  const answer = await load(code);
  const t = await getTranslations("hosted");
  if (!answer) return { title: t("unavailableTitle") };
  const c = answer.page.content;
  const name = "name" in c ? c.name : "title" in c ? c.title : "";
  return { title: name || "HeyQR" };
}

export default async function PublicHostedPage({ params }: PageProps<"/p/[code]">) {
  const { code } = await params;
  await applyVisitorLocale();
  const answer = await load(code);
  if (!answer) return <Unavailable />;
  const now = new Date();
  const content = publicHostedContent(answer.page.content, code, now);
  const device = deviceFromUserAgent((await headers()).get("user-agent"));
  const desktop = content.type === "apps" && device === "other";
  const t = await getTranslations("hosted.apps");
  return (
    <HostedShell wide={desktop}>
      <HostedPage
        content={content}
        mode="public"
        now={now}
        desktop={desktop}
        desktopQr={
          desktop ? (
            <QrPreview
              layout={designToLayout(DEFAULT_DESIGN)}
              value={shortLinkUrl(env.NEXT_PUBLIC_SHORT_LINK_BASE, code)}
              label={t("qrLabel")}
              className="w-full"
            />
          ) : undefined
        }
        reportHref={`/p/${code}/report`}
      />
    </HostedShell>
  );
}
