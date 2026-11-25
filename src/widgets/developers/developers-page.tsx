import { CheckIcon, ExternalLinkIcon, KeyRoundIcon, PackageIcon, ServerIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { npmUrl, PACKAGE_RELEASE } from "@/shared/config/developers";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { CodeBlock } from "./code-block";
import { DocsNav, type DocsNavGroup } from "./docs-nav";
import { InstallTabs } from "./install-tabs";
import { NotifyForm } from "./notify-form";
import {
  AUTH_SNIPPET,
  CURL_CREATE,
  CURL_DESTINATION,
  CURL_EXPORT,
  INSTALL,
  LOGO_SNIPPET,
  PNG_SNIPPET,
  SCAN_SNIPPET,
  SDK_INSTALL,
  SDK_SNIPPET,
  SVG_SNIPPET,
} from "./snippets";

const ERROR_SHAPE = `{ "error": { "code": "invalid_request", "message": "…", "details": [{ "path": "content.url", "message": "…" }] } }`;

/*
 * Design 12.1–12.4 "/developers": the free @heyqr/qr-core package (static codes, local, no account) and the REST API
 * with @heyqr/sdk (the account's codes, with an API key). Release status comes from PACKAGE_RELEASE: while a package
 * isn't on npm the page says so and offers "Email me" instead of install commands and npm links.
 */
export async function DevelopersPage({ apiBase }: { apiBase: string }) {
  const t = await getTranslations("developers");
  const qrCore = PACKAGE_RELEASE.qrCore;
  const sdk = PACKAGE_RELEASE.sdk;
  const copy = { copyLabel: t("copy"), copiedLabel: t("copied") };
  const groups: DocsNavGroup[] = [
    {
      label: t("nav.groupPkg"),
      items: (["pkg", "install", "svg", "png", "opts", "scan"] as const).map((k) => ({ id: `dv-${k}`, label: t(`nav.${k}`) })),
    },
    {
      label: t("nav.groupRest"),
      items: [
        { id: "dv-rest", label: t("nav.restStart") },
        { id: "dv-rest-auth", label: t("nav.restAuth") },
        { id: "dv-rest-endpoints", label: t("nav.restEndpoints") },
        { id: "dv-rest-sdk", label: t("nav.restSdk") },
        { id: "dv-rest-errors", label: t("nav.restErrors") },
        { id: "dv-rest-revisions", label: t("nav.restRevisions") },
        { id: "dv-rest-idempotency", label: t("nav.restIdempotency") },
        { id: "dv-rest-export", label: t("nav.restExport") },
      ],
    },
  ];
  const status = (published: boolean) => (
    <Badge variant={published ? "success" : "warning"}>{published ? t("statusLive") : t("statusUnpublished")}</Badge>
  );
  const endpoints = [
    ["POST", "/api/v1/qr-codes", "create"],
    ["GET", "/api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}", "getLayout"],
    ["PATCH", "/api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}", "patchLayout"],
    ["GET", "/api/v1/qr-codes/{qrCodeId}/destination", "getDestination"],
    ["PATCH", "/api/v1/qr-codes/{qrCodeId}/destination", "patchDestination"],
    ["GET", "/api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}/export", "export"],
  ] as const;
  const errors = [
    ["400", "malformed_json", "e400"],
    ["401", "unauthorized", "e401"],
    ["402", "payment_required", "e402"],
    ["403", "draft_limit", "e403"],
    ["404", "not_found", "e404"],
    ["409", "revision_conflict · idempotency_key_reused", "e409"],
    ["422", "invalid_request", "e422"],
    ["500", "internal_error", "e500"],
  ] as const;
  const options = [
    ["pattern", '"square" | "rounded" | "dot" | "diamond" | "leaf" | "fluid" | "vbars" | "hbars"', true],
    ["eyeFrame", '"square" | "rounded" | "cushion" | "circle" | "leaf"', true],
    ["eyeBall", '"square" | "rounded" | "circle" | "diamond" | "leaf"', true],
    ["colors", "{ fg, eye, eyeIn, bg }", true],
    ["logo", '{ iconPath?, href?, size, plate: "none" | "square" | "circle" }', false],
    ["centerText", "{ text, bg, color, fontFamily }", false],
  ] as const;

  return (
    <div className="flex flex-col gap-8 py-8 lg:py-12">
      <header className="flex max-w-180 flex-col gap-3">
        <span className="text-kicker text-accent-text uppercase">{t("kicker")}</span>
        <h1 className="text-h1x text-balance">{t("title")}</h1>
        <p className="text-body-lg text-secondary-foreground">{t("lead")}</p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <a href="#dv-pkg" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 hover:border-border-hover">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-h3">
              <PackageIcon aria-hidden className="size-5" />
              {t("cards.pkgTitle")}
            </span>
            {status(qrCore.published)}
          </span>
          <span className="text-secondary-foreground">{t("cards.pkgText")}</span>
        </a>
        <a href="#dv-rest" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 hover:border-border-hover">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-h3">
              <ServerIcon aria-hidden className="size-5" />
              {t("cards.restTitle")}
            </span>
            <Badge variant="success">{t("statusApi")}</Badge>
          </span>
          <span className="text-secondary-foreground">{t("cards.restText")}</span>
        </a>
      </div>

      <div className="grid gap-8 min-[900px]:grid-cols-[13.5rem_minmax(0,1fr)] min-[900px]:items-start lg:gap-12">
        <DocsNav groups={groups} title={t("onThisPage")} />
        <div className="flex min-w-0 flex-col gap-12">
          <Section id="dv-pkg" title={t("pkg.title")} badge={status(qrCore.published)}>
            <p className="text-secondary-foreground">{t("pkg.text")}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {(["free", "account", "local", "types"] as const).map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  {t(`pkg.points.${k}`)}
                </li>
              ))}
            </ul>
            <p className="rounded-lg bg-subtle px-4 py-3 text-caption text-secondary-foreground">{t("pkg.static")}</p>
          </Section>

          <Section id="dv-install" title={t("install.title")}>
            {qrCore.published ? (
              <>
                <InstallTabs commands={INSTALL} label={t("install.managers")} {...copy} />
                <a
                  href={npmUrl(qrCore.name)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-label underline underline-offset-2"
                >
                  {t("install.npmLink", { name: qrCore.name })}
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                  <span className="sr-only">{t("opensNewTab")}</span>
                </a>
              </>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-5">
                <div className="flex items-center gap-2">
                  <Badge variant="warning">{t("install.unpublishedTitle")}</Badge>
                </div>
                <p className="text-secondary-foreground">{t("install.unpublishedText")}</p>
                <NotifyForm />
              </div>
            )}
            <p className="text-caption text-muted-foreground">{t("install.note")}</p>
          </Section>

          <Section id="dv-svg" title={t("svg.title")} badge={<Badge>{t("svg.where")}</Badge>}>
            <p className="text-secondary-foreground">{t("svg.text")}</p>
            <CodeBlock name="render-svg.ts" code={SVG_SNIPPET} {...copy} />
          </Section>

          <Section id="dv-png" title={t("png.title")} badge={<Badge>{t("png.where")}</Badge>}>
            <p className="text-secondary-foreground">{t("png.text")}</p>
            <CodeBlock name="save-png.mjs" code={PNG_SNIPPET} {...copy} />
          </Section>

          <Section id="dv-opts" title={t("opts.title")}>
            <p className="text-secondary-foreground">{t("opts.text")}</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[34rem] text-left text-[0.875rem]">
                <thead className="bg-subtle text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("opts.option")}</th>
                    <th className="px-3 py-2 font-semibold">{t("opts.type")}</th>
                    <th className="px-3 py-2 font-semibold">{t("opts.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {options.map(([k, type, required]) => (
                    <tr key={k} className="border-t border-border align-top">
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                        {k}
                        {required ? (
                          <span className="ml-2 font-sans text-micro text-accent-text uppercase">{t("opts.required")}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-caption text-secondary-foreground">{type}</td>
                      <td className="px-3 py-2.5 text-secondary-foreground">{t(`opts.rows.${k}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="text-h3">{t("opts.logoTitle")}</h3>
            <CodeBlock name="logo-style.ts" code={LOGO_SNIPPET} {...copy} />
          </Section>

          <Section id="dv-scan" title={t("scan.title")} badge={<Badge>{t("scan.where")}</Badge>}>
            <p className="text-secondary-foreground">{t("scan.text")}</p>
            <CodeBlock name="scan-check.ts" code={SCAN_SNIPPET} {...copy} />
          </Section>

          <Section id="dv-rest" title={t("rest.title")} badge={<Badge variant="success">{t("statusApi")}</Badge>}>
            <p className="text-secondary-foreground">{t("rest.lead")}</p>
            <h3 className="text-h3">{t("rest.startTitle")}</h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>{t("rest.start1")}</li>
              <li>{t("rest.start2")}</li>
              <li>{t("rest.start3")}</li>
            </ol>
            <Button asChild variant="secondary" size="sm" className="self-start">
              <Link href="/dashboard/api-keys">
                <KeyRoundIcon aria-hidden />
                {t("rest.keysLink")}
              </Link>
            </Button>
            <p className="rounded-lg bg-warning-soft px-4 py-3 text-caption text-warning">{t("rest.secret")}</p>
          </Section>

          <Section id="dv-rest-auth" title={t("rest.authTitle")} level={3}>
            <CodeBlock name="header" code={AUTH_SNIPPET} {...copy} />
            <p className="text-secondary-foreground">{t("rest.authText")}</p>
          </Section>

          <Section id="dv-rest-endpoints" title={t("rest.endpointsTitle")} level={3}>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem] text-left text-[0.875rem]">
                <thead className="bg-subtle text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("rest.method")}</th>
                    <th className="px-3 py-2 font-semibold">{t("rest.path")}</th>
                    <th className="px-3 py-2 font-semibold">{t("rest.what")}</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map(([m, path, k]) => (
                    <tr key={`${m} ${path}`} className="border-t border-border align-top">
                      <td className="px-3 py-2.5 font-mono font-semibold">{m}</td>
                      <td className="px-3 py-2.5 font-mono text-caption break-all">{path}</td>
                      <td className="px-3 py-2.5 text-secondary-foreground">{t(`rest.endpoints.${k}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock name="create.sh" code={CURL_CREATE(apiBase)} {...copy} />
            <CodeBlock name="destination.sh" code={CURL_DESTINATION(apiBase)} {...copy} />
            <p className="text-caption text-muted-foreground">{t("rest.hostedNote")}</p>
          </Section>

          <Section id="dv-rest-sdk" title={t("rest.sdkTitle")} level={3} badge={status(sdk.published)}>
            <p className="text-secondary-foreground">{t("rest.sdkText")}</p>
            {sdk.published ? (
              <InstallTabs commands={SDK_INSTALL} label={t("install.managers")} {...copy} />
            ) : (
              <p className="text-caption text-muted-foreground">{t("rest.sdkUnpublished")}</p>
            )}
            <CodeBlock name="destination.ts" code={SDK_SNIPPET} {...copy} />
          </Section>

          <Section id="dv-rest-errors" title={t("rest.errorsTitle")} level={3}>
            <p className="text-secondary-foreground">{t("rest.errorsText")}</p>
            <CodeBlock name="error.json" code={ERROR_SHAPE} {...copy} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[34rem] text-left text-[0.875rem]">
                <thead className="bg-subtle text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("rest.status")}</th>
                    <th className="px-3 py-2 font-semibold">{t("rest.code")}</th>
                    <th className="px-3 py-2 font-semibold">{t("rest.when")}</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map(([s, c, k]) => (
                    <tr key={s} className="border-t border-border align-top">
                      <td className="px-3 py-2.5 font-mono font-semibold">{s}</td>
                      <td className="px-3 py-2.5 font-mono text-caption">{c}</td>
                      <td className="px-3 py-2.5 text-secondary-foreground">{t(`rest.errors.${k}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-caption text-muted-foreground">{t("rest.limits")}</p>
          </Section>

          <Section id="dv-rest-revisions" title={t("rest.revisionsTitle")} level={3}>
            <p className="text-secondary-foreground">{t("rest.revisionsText")}</p>
          </Section>
          <Section id="dv-rest-idempotency" title={t("rest.idempotencyTitle")} level={3}>
            <p className="text-secondary-foreground">{t("rest.idempotencyText")}</p>
          </Section>
          <Section id="dv-rest-export" title={t("rest.exportTitle")} level={3}>
            <p className="text-secondary-foreground">{t("rest.exportText")}</p>
            <CodeBlock name="export.sh" code={CURL_EXPORT(apiBase)} {...copy} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  badge,
  children,
  level = 2,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-[calc(var(--spacing-header)+1rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <H id={`${id}-title`} tabIndex={-1} className={level === 2 ? "text-h2" : "text-h3"}>
          {title}
        </H>
        {badge}
      </div>
      {children}
    </section>
  );
}
