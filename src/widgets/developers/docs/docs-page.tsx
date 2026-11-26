import {
  BookOpenIcon,
  BracesIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  PackageIcon,
  ScanIcon,
  ServerIcon,
  TriangleAlertIcon,
  ZapIcon,
  ArrowRightIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { npmUrl, PACKAGE_RELEASE } from "@/shared/config/developers";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { pageCopy, plain, type Block, type PageCopy } from "./blocks";
import { CodeBlock, type CodeLabels } from "./code-block";
import { DocsNav, type NavItem, type SearchEntry } from "./docs-nav";
import { EXAMPLES, INSTALL_COMMANDS, TABBED, type CodeEnv } from "./examples";
import { Helpful, SignupForm } from "./forms";
import { HashTarget } from "./hash-target";
import { OnThisPage } from "./on-this-page";
import { docsHref, DOCS_GROUPS, neighbours, searchablePages, visiblePages, type DocsPage as Page } from "./registry";

type T = Awaited<ReturnType<typeof getTranslations<"developers.docs">>>;

/** `code spans` in a sentence. */
function Md({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 1 ? (
          <code key={i} className="rounded-sm border border-border bg-subtle px-1 py-px font-mono text-[0.8125em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const CARD_ICONS: Record<string, typeof ZapIcon> = {
  zap: ZapIcon,
  book: BookOpenIcon,
  scan: ScanIcon,
  braces: BracesIcon,
  pkg: PackageIcon,
  server: ServerIcon,
};

function Note({ kind, children }: { kind: "info" | "warn" | "preview" | "design"; children: ReactNode }) {
  const Icon = kind === "info" ? InfoIcon : TriangleAlertIcon;
  return (
    <div
      role={kind === "preview" || kind === "design" ? "note" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-4 py-3 text-caption",
        kind === "info" ? "bg-info-soft text-info" : "bg-warning-soft text-warning",
        (kind === "preview" || kind === "design") && "border border-warning",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Design 12.11: a table from 768 px; below, each row is a labelled card. */
function DocsTable({ block, requiredLabel }: { block: Extract<Block, { k: "table" }>; requiredLabel: string }) {
  const key = (i: number) => block.keyCol !== false && i === 0;
  const cell = (row: { cells: string[]; required?: boolean }, c: string, i: number) => (
    <>
      <Md text={c} />
      {key(i) && block.reqCol && row.required ? (
        <span className="ms-2 font-sans text-micro font-semibold text-danger uppercase">{requiredLabel}</span>
      ) : null}
    </>
  );
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-start text-[0.875rem]">
          <caption className="sr-only">{block.label}</caption>
          <thead className="bg-subtle text-micro text-muted-foreground uppercase">
            <tr>
              {block.cols.map((c) => (
                <th key={c} scope="col" className="px-4 py-2.5 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, ri) => (
              <tr key={ri} className="border-t border-border align-top">
                {r.cells.map((c, i) =>
                  key(i) ? (
                    <th key={i} scope="row" className="px-4 py-3 font-normal [&_code]:font-semibold">
                      {cell(r, c, i)}
                    </th>
                  ) : (
                    <td key={i} className="px-4 py-3 text-secondary-foreground">
                      {cell(r, c, i)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={block.label} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface md:hidden">
        {block.rows.map((r, ri) => (
          <li key={ri} className="flex flex-col gap-1 border-t border-border px-4 py-3 first:border-t-0">
            <span className="[&_code]:font-semibold">{cell(r, r.cells[0] ?? "", 0)}</span>
            <dl className="flex flex-col gap-1">
              {r.cells.slice(1).map((c, i) => (
                <div key={i}>
                  <dt className="text-micro text-muted-foreground uppercase">{block.cols[i + 1]}</dt>
                  <dd className="text-[0.875rem] text-secondary-foreground">
                    <Md text={c} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function codeLabels(t: T, env: CodeEnv): CodeLabels {
  return {
    copy: t("copy"),
    copied: t("copied"),
    copiedAnnounce: t("copiedAnnounce", { file: "{file}" }),
    copyFailed: t("copyFailed"),
    env: t(`env.${env}`),
  };
}

async function renderBlock(b: Block, i: number, t: T, page: Page): Promise<ReactNode> {
  switch (b.k) {
    case "p":
      return (
        <p key={i} className="text-body text-secondary-foreground">
          <Md text={b.t} />
        </p>
      );
    case "h2":
      return (
        <h2
          key={i}
          id={b.id}
          tabIndex={-1}
          className="scroll-mt-[calc(var(--spacing-header)+5rem)] border-t border-border pt-6 text-h2 first:border-t-0 first:pt-0"
        >
          <a href={`#${b.id}`} className="no-underline hover:underline">
            {b.t}
          </a>
        </h2>
      );
    case "h3":
      return (
        <h3 key={i} className="text-h3">
          {b.t}
        </h3>
      );
    case "note":
      return (
        <Note key={i} kind={b.kind}>
          {b.kind === "design" ? (
            <Badge variant="warning" className="me-2">
              {t("designPreview")}
            </Badge>
          ) : null}
          <Md text={b.t} />
        </Note>
      );
    case "list":
      return (
        <ul key={i} className="flex flex-col gap-2">
          {b.items.map((it) => (
            <li key={it} className="flex items-start gap-2.5">
              <CheckIcon aria-hidden className="mt-1 size-4 shrink-0 text-success" />
              <span>
                <Md text={it} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol key={i} className="flex flex-col gap-3">
          {b.items.map((s, n) => (
            <li key={s.title} className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-caption font-bold text-accent-foreground">
                {n + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-label font-semibold">{s.title}</span>
                <span className="text-secondary-foreground">
                  <Md text={s.t} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      );
    case "code": {
      const ex = EXAMPLES[b.example];
      return (
        <CodeBlock
          key={i}
          file={ex.file}
          tabs={[{ id: "code", label: ex.file, code: ex.code }]}
          prompt={"prompt" in ex && ex.prompt}
          labels={codeLabels(t, ex.env)}
        />
      );
    }
    case "tabs": {
      const ex = TABBED[b.example];
      const tabs = ex.tabs.map((tab) => ({
        ...tab,
        note: "note" in tab && tab.note ? plain(t(`responseNotes.${tab.note}` as never)) : undefined,
      }));
      return <CodeBlock key={i} tabs={tabs} tabsLabel={b.label} labels={codeLabels(t, ex.env)} />;
    }
    case "table":
      return <DocsTable key={i} block={b} requiredLabel={t("required")} />;
    case "chips":
      return (
        <div key={i} className="flex flex-col gap-2">
          <span className="font-mono text-caption text-muted-foreground">{b.t}</span>
          <ul className="flex flex-wrap gap-1.5">
            {b.items.map((c) => (
              <li key={c} className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-caption">
                {c}
              </li>
            ))}
          </ul>
        </div>
      );
    case "cards":
      return (
        <ul key={i} className="grid gap-3 sm:grid-cols-2">
          {b.items.map((c) => {
            const Icon = CARD_ICONS[c.icon] ?? BookOpenIcon;
            const target = visiblePages(false).find((p) => p.id === c.page);
            return (
              <li key={c.page}>
                <Link
                  href={target ? docsHref(target) : "/developers"}
                  className="flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-4 hover:border-border-hover"
                >
                  <span className="bg-accent-bg grid size-10 shrink-0 place-items-center rounded-lg text-accent-text">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-label font-semibold">{c.title}</span>
                    <span className="text-caption text-secondary-foreground">{c.t}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      );
    case "faq":
      return (
        <div key={i} className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {b.items.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-label font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-90" />
              </summary>
              <p className="px-4 pb-4 text-secondary-foreground">
                <Md text={f.a} />
              </p>
            </details>
          ))}
        </div>
      );
    case "endpoint":
      return (
        <div key={i} className="grid gap-2">
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="text-micro text-muted-foreground uppercase">{t("endpoint.auth")}</span>
            <p className="flex items-center gap-2 font-mono text-caption">
              <KeyRoundIcon aria-hidden className="size-3.5" />
              {t("endpoint.authValue")}
            </p>
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <div className="rounded-xl border border-border bg-surface px-4 py-3">
              <span className="block text-micro text-muted-foreground uppercase">{t("endpoint.method")}</span>
              <Badge variant="success" className="mt-1 font-mono">
                {b.method}
              </Badge>
            </div>
            <div className="min-w-0 rounded-xl border border-border bg-surface px-4 py-3">
              <span className="block text-micro text-muted-foreground uppercase">{t("endpoint.url")}</span>
              <code className="mt-1 block font-mono text-caption break-all">{b.url}</code>
              {page.visibility === "restPreview" ? <span className="text-micro text-muted-foreground">{t("endpoint.base")}</span> : null}
            </div>
          </div>
        </div>
      );
    case "install": {
      const pkg = PACKAGE_RELEASE[b.package];
      const cmds = INSTALL_COMMANDS[b.package];
      if (pkg.published)
        return (
          <div key={i} className="flex flex-col gap-2.5">
            <a
              href={npmUrl(pkg.name)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-label text-accent-text underline underline-offset-2"
            >
              {t("install.npmLink", { name: pkg.name })}
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              <span className="sr-only">{t("install.opensNewTab")}</span>
            </a>
            <CodeBlock
              tabs={[
                { id: "npm", label: "npm", code: cmds.npm },
                { id: "pnpm", label: "pnpm", code: cmds.pnpm },
                { id: "yarn", label: "Yarn", code: cmds.yarn },
              ]}
              tabsLabel={t("install.managers")}
              prompt
              labels={codeLabels(t, "shell")}
            />
          </div>
        );
      return (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong bg-surface p-4">
          <Badge variant="warning">{t("install.unpublishedTitle")}</Badge>
          <p className="text-secondary-foreground">{t("install.unpublishedText", { name: pkg.name, version: pkg.version })}</p>
          <SignupForm topic="packages" labels={signupLabels(t, "notifyPackages")} />
        </div>
      );
    }
    case "products": {
      const live = PACKAGE_RELEASE.qrCore.published;
      return (
        <ul key={i} className="grid gap-3 sm:grid-cols-2">
          {[
            {
              href: "/developers/install",
              Icon: PackageIcon,
              title: t("products.pkgTitle"),
              text: t("products.pkgText"),
              badge: <Badge variant={live ? "success" : "warning"}>{live ? t("status.liveOnNpm") : t("status.unpublished")}</Badge>,
            },
            {
              href: "/developers/rest",
              Icon: ServerIcon,
              title: t("products.restTitle"),
              text: t("products.restText"),
              badge: <Badge>{t("status.soon")}</Badge>,
            },
          ].map(({ href, Icon, title, text, badge }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-4 hover:border-border-hover"
              >
                <span className="bg-accent-bg grid size-10 shrink-0 place-items-center rounded-lg text-accent-text">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-label font-semibold">
                    {title}
                    {badge}
                  </span>
                  <span className="text-caption text-secondary-foreground">{text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    }
    case "restSoon":
      return (
        <div key={i} className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
            <span className="bg-accent-bg grid size-10 shrink-0 place-items-center rounded-lg text-accent-text">
              <ServerIcon aria-hidden className="size-5" />
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-label font-semibold">
                {t("restSoon.cardTitle")}
                <Badge>{t("status.soon")}</Badge>
              </span>
              <span className="text-caption text-secondary-foreground">{t("restSoon.cardText")}</span>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-label font-semibold">{t("restSoon.planned")}</h2>
            <ul className="flex flex-col gap-1.5">
              {(t.raw("restSoon.items") as string[]).map((it) => (
                <li key={it} className="flex items-center gap-2 text-secondary-foreground">
                  <CircleDashedIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
          <SignupForm topic="rest" labels={signupLabels(t, "waitlist")} />
          <Link href="/developers/install" className="inline-flex items-center gap-1.5 self-start text-label font-semibold">
            {t("restSoon.npmLink")}
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        </div>
      );
  }
}

function signupLabels(t: T, key: "waitlist" | "notifyPackages") {
  const w = (k: string) => t(`waitlist.${k}` as never);
  const own = (k: string) => (key === "waitlist" ? w(k) : t(`notifyPackages.${k}` as never));
  return {
    label: own("label"),
    placeholder: w("placeholder"),
    join: own("join"),
    joining: w("joining"),
    invalid: w("invalid"),
    failed: w("failed"),
    joined: (key === "waitlist" ? t.raw("waitlist.joined") : t.raw("notifyPackages.joined")) as string,
    hint: own("hint"),
  };
}

/**
 * One docs page in the shared layout (design 12.1): sidebar with search, breadcrumb, title and intro, "On this page"
 * (inline below 1280 px, the right rail from 1280 px), the page's blocks, "Was this page helpful?", Previous / Next and
 * the source note.
 */
export async function DocsPage({ page, previews }: { page: Page; previews: boolean }) {
  const t = await getTranslations("developers.docs");
  const copyOf = (id: string): PageCopy => pageCopy(t.raw(`pages.${id}` as never));
  const copy = copyOf(page.id);
  const sections = copy.blocks.flatMap((b) => (b.k === "h2" ? [{ id: b.id, title: b.t }] : []));
  const items: NavItem[] = visiblePages(true).flatMap((p): NavItem[] => {
    const label = copyOf(p.id).nav ?? copyOf(p.id).title;
    if (p.visibility === "public") return [{ id: p.id, href: docsHref(p), label, group: p.group }];
    return [
      {
        id: p.id,
        href: docsHref(p),
        label,
        group: p.group,
        state: previews ? (p.visibility === "designPreview" ? "design" : "preview") : "soon",
      },
    ];
  });
  const index: SearchEntry[] = searchablePages().map((p) => {
    const c = copyOf(p.id);
    return {
      href: docsHref(p),
      title: c.title,
      lead: plain(c.lead),
      group: p.group,
      sections: c.blocks.flatMap((b) => (b.k === "h2" ? [{ href: `${docsHref(p)}#${b.id}`, title: b.t }] : [])),
    };
  });
  const { previous, next } = neighbours(page, previews);
  const qrCore = PACKAGE_RELEASE.qrCore;
  const route = docsHref(page);
  const isRest = page.group === "rest" && page.visibility !== "public";
  const footer =
    page.visibility === "designPreview"
      ? t("footer.proposed")
      : isRest
        ? t("footer.restChecked", { route })
        : t("footer.checked", { version: qrCore.version, route });
  return (
    <div id="docs-top" className="mx-auto w-full max-w-wide px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <HashTarget legacy={page.id === "overview"} />
      <div className="flex flex-col gap-6 min-[900px]:flex-row min-[900px]:items-start min-[900px]:gap-12">
        <DocsNav
          items={items}
          current={page.id}
          index={index}
          pageTitle={copy.title}
          labels={{
            groups: Object.fromEntries(DOCS_GROUPS.map((g) => [g, t(`groups.${g}`)])) as Record<(typeof DOCS_GROUPS)[number], string>,
            search: t("search.placeholder"),
            clear: t("search.clear"),
            resultsOne: t("search.resultOne"),
            resultsOther: t("search.resultOther"),
            empty: t.raw("search.empty") as string,
            emptyHint: t("search.emptyHint"),
            suggestions: t.raw("search.suggestions") as string[],
            soon: t("soon"),
            preview: t("preview"),
            menuOpen: t("menu.open"),
            menuClose: t("menu.close"),
            menuLabel: t("menu.label"),
            packageName: `${qrCore.name} ${qrCore.version}`,
            packageStatus: qrCore.published ? t("status.live") : t("status.unpublished"),
            packageLive: qrCore.published,
            restBadge: previews ? t("preview") : t("soon"),
          }}
        />
        <div className="flex min-w-0 flex-1 gap-12">
          <article className="flex w-full max-w-195 min-w-0 flex-col gap-6">
            <nav aria-label={t("breadcrumb")} className="text-caption text-muted-foreground">
              <ol className="flex flex-wrap items-center gap-1.5">
                <li>
                  <Link href="/developers" className="underline underline-offset-2 hover:text-foreground">
                    {t("breadcrumbRoot")}
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li>{t(`groups.${page.group}`)}</li>
                {page.id !== "overview" ? (
                  <>
                    <li aria-hidden>/</li>
                    <li aria-current="page" className="font-semibold text-foreground">
                      {copy.nav ?? copy.title}
                    </li>
                  </>
                ) : null}
              </ol>
            </nav>
            <header className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-h1x text-balance">{copy.title}</h1>
                {page.env === "node" ? <Badge variant="dark">{t("env.node")}</Badge> : null}
                {page.visibility !== "public" ? (
                  <Badge variant="warning">{page.visibility === "designPreview" ? t("designPreview") : t("notPublic")}</Badge>
                ) : null}
              </div>
              <p className="text-body-lg text-secondary-foreground">
                <Md text={copy.lead} />
              </p>
            </header>
            <div className="min-[1280px]:hidden">
              <OnThisPage variant="inline" sections={sections} title={t("onThisPage")} backToTop={t("backToTop")} />
            </div>
            <div className="flex flex-col gap-5">{await Promise.all(copy.blocks.map((b, i) => renderBlock(b, i, t, page)))}</div>
            <footer className="mt-6 flex flex-col gap-5 border-t border-border pt-6">
              <Helpful
                page={page.id}
                labels={{
                  question: t("helpful.question"),
                  yes: t("helpful.yes"),
                  no: t("helpful.no"),
                  sending: t("helpful.sending"),
                  thanks: t("helpful.thanks"),
                  failed: t("helpful.failed"),
                }}
              />
              <nav aria-label={`${t("previous")} / ${t("next")}`} className="grid gap-3 sm:grid-cols-2">
                {previous ? (
                  <Link
                    href={docsHref(previous)}
                    rel="prev"
                    className="flex flex-col rounded-xl border border-border bg-surface px-4 py-3 hover:border-border-hover"
                  >
                    <span className="text-micro text-muted-foreground uppercase">{t("previous")}</span>
                    <span className="text-label font-semibold">{copyOf(previous.id).nav ?? copyOf(previous.id).title}</span>
                  </Link>
                ) : (
                  <span aria-hidden className="max-sm:hidden" />
                )}
                {next ? (
                  <Link
                    href={docsHref(next)}
                    rel="next"
                    className="flex flex-col items-end rounded-xl border border-border bg-surface px-4 py-3 text-end hover:border-border-hover"
                  >
                    <span className="text-micro text-muted-foreground uppercase">{t("next")}</span>
                    <span className="text-label font-semibold">{copyOf(next.id).nav ?? copyOf(next.id).title}</span>
                  </Link>
                ) : null}
              </nav>
              <p className="text-caption text-muted-foreground">{footer}</p>
            </footer>
          </article>
          <aside className="hidden w-52 shrink-0 min-[1280px]:block">
            <OnThisPage variant="rail" sections={sections} title={t("onThisPage")} backToTop={t("backToTop")} />
          </aside>
        </div>
      </div>
    </div>
  );
}
