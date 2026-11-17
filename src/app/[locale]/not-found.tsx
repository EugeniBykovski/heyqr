import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors.notFound");
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <p className="text-display text-violet-600">404</p>
      <h1 className="text-h1">{t("title")}</h1>
      <p className="text-body text-secondary-foreground">{t("text")}</p>
      <Button asChild variant="primary">
        <Link href="/">{t("cta")}</Link>
      </Button>
    </section>
  );
}
