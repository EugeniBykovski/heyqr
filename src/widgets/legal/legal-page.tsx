import { TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { placeholders, type LegalBlock, type LegalDocument } from "@/shared/content/legal/types";

/** `[[…]]` placeholders render as a visible mark, so an unconfirmed fact can never read like a decision. */
async function Text({ text }: { text: string }) {
  const t = await getTranslations("legal");
  return (
    <>
      {placeholders(text).map((part, i) =>
        part.placeholder ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-1 text-warning">
            <span className="sr-only">{t("placeholder")}: </span>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

async function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string")
    return (
      <p className="text-body text-secondary-foreground">
        <Text text={block} />
      </p>
    );
  return (
    <ul className="flex list-disc flex-col gap-2 ps-5 text-body text-secondary-foreground marker:text-muted-foreground">
      {block.list.map((item) => (
        <li key={item}>
          <Text text={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * HEY-193 Terms / Privacy: a readable single column with a draft banner (the text isn't approved yet), the last-updated
 * date, "On this page" section links and anchorable sections. The policy text is English only for now: other
 * languages say so and mark the text as English (lang="en") so screen readers read it correctly.
 */
export async function LegalPage({ doc, locale }: { doc: LegalDocument; locale: string }) {
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const english = locale === "en";
  const updated = format.dateTime(new Date(`${doc.updated}T12:00:00Z`), { dateStyle: "long", timeZone: "UTC" });
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-12">
        <header className="flex flex-col gap-4 lg:col-span-2">
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-caption text-warning"
          >
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t("draft")}</span>
          </div>
          <h1 className="text-h1 text-balance">{t(`${doc.id}.title`)}</h1>
          <p className="text-caption text-muted-foreground">
            {t("updated", { date: updated })} · {t("effectiveNote")}
          </p>
          {english ? null : <p className="rounded-lg bg-subtle px-4 py-3 text-caption text-secondary-foreground">{t("englishOnly")}</p>}
        </header>
        <nav aria-label={t("onThisPage")} className="lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)]">
          <h2 className="pb-2 text-micro text-muted-foreground uppercase">{t("onThisPage")}</h2>
          <ol lang="en" className="flex flex-col gap-1 border-s border-border ps-4 text-[0.875rem]">
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex min-h-8 items-center text-secondary-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article lang="en" className="flex max-w-[68ch] min-w-0 flex-col gap-8">
          <p className="text-body-lg text-secondary-foreground">
            <Text text={doc.intro} />
          </p>
          {doc.sections.map((s) => (
            <section key={s.id} aria-labelledby={`${s.id}-title`} className="flex flex-col gap-3">
              <h2 id={`${s.id}-title`} className="scroll-mt-[calc(var(--spacing-header)+1.5rem)] text-h2">
                <a id={s.id} href={`#${s.id}`} className="scroll-mt-[calc(var(--spacing-header)+1.5rem)] no-underline hover:underline">
                  {s.title}
                </a>
              </h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
