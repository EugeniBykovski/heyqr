"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { reportPageFailure } from "@/shared/lib/monitoring/report-client";
import { Button } from "@/shared/ui/button";

/** HEY-175: a page under a locale that failed to render (editor, dashboard, checkout return, …): reported once. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("errors.page");
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the reference is known only once the report is made
    setRef(reportPageFailure(error, "segment"));
  }, [error]);
  return (
    <section role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <h1 className="text-h1">{t("title")}</h1>
      <p className="text-body text-secondary-foreground">{t("text")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => retry()}>
          {t("retry")}
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
      {ref ? <p className="font-mono text-caption text-muted-foreground">{t("reference", { ref })}</p> : null}
    </section>
  );
}
