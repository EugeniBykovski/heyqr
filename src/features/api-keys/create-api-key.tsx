"use client";

import { KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/features/copy-to-clipboard";
import { useRouter } from "@/i18n/navigation";
import { issueApiKey } from "@/server/actions/api-keys";
import { Button } from "@/shared/ui/button";

/*
 * HEY-153: "Create API key". The full key lives only in this component's state, from the creation response: it is
 * shown once with Copy and a warning, and Done (or leaving / refreshing the page) clears it for good. The list on the
 * page shows only the prefix and creation date.
 */
export function CreateApiKey() {
  const t = useTranslations("apiKeys");
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      const result = await issueApiKey().catch(() => ({ ok: false, error: "failed" }) as const);
      if (result.ok) setKey(result.data.key);
      else toast.error(t("failed"), { id: "api-key" });
    });
  if (key)
    return (
      <div role="status" data-slot="api-key-issued" className="flex flex-col gap-3 rounded-lg bg-warning-soft px-4 py-3.5">
        <p className="flex items-start gap-2 text-label">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("once")}
        </p>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <code data-slot="api-key-value" className="min-w-0 grow font-mono text-[0.8125rem] break-all">
            {key}
          </code>
          <CopyButton value={key} label={t("copy")} copiedLabel={t("copied")} />
        </div>
        <Button
          className="self-start"
          onClick={() => {
            setKey(null);
            router.refresh();
          }}
        >
          {t("done")}
        </Button>
      </div>
    );
  return (
    <Button variant="primary" className="self-start" onClick={create} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <KeyRoundIcon aria-hidden />}
      {t("create")}
    </Button>
  );
}
