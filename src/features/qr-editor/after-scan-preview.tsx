"use client";

import { directContent, isHostedContent, type EditorDesign } from "@/entities/qr";
import { ContentPreview } from "./content-preview";
import { HostedPreview } from "./hosted-preview";

/**
 * Design 1.6 / 10.7: what the Design stage's "After scan" view shows, for every type: the hosted page for hosted types,
 * the phone's own screen (website, Wi-Fi, contact card, text, event…) for codes that open straight from the code.
 */
export function AfterScanPreview({ design, shortLabel }: { design: EditorDesign; shortLabel: string }) {
  return isHostedContent(design.content) ? (
    <HostedPreview content={design.content} shortLabel={shortLabel} />
  ) : (
    <ContentPreview content={directContent(design.content)} mode={design.model} />
  );
}
