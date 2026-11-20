"use client";

import { CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";

/*
 * Design 4.3 "Use different content…": a static code's content is in its pattern, so other content is a new code.
 * The dialog says so and what it costs before anything happens; this code and its files stay as they are.
 */
export function DifferentContent({ price }: { price: string }) {
  const t = useTranslations("qr.details.copy");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="self-start">
          <CopyIcon aria-hidden />
          {t("action")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")}>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("text", { price })}</DialogDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild variant="primary">
            <Link href="/create?step=type">{t("start")}</Link>
          </Button>
          <DialogClose asChild>
            <Button variant="ghost">{t("keep")}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
