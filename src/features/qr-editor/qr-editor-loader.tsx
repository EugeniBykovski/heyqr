"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/shared/ui/skeleton";

/** The editor reads the guest draft from localStorage on first render, so it is rendered in the browser only. */
export const QrEditorLoader = dynamic(() => import("./qr-editor").then((m) => m.QrEditor), {
  ssr: false,
  loading: () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <Skeleton className="order-2 h-[36rem] rounded-xl lg:order-1" />
      <Skeleton className="order-1 aspect-square rounded-xl lg:order-2" />
    </div>
  ),
});
