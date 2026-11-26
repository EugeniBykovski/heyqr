"use client";

import {
  CENTER_LOGO_SIZE,
  CENTER_TEXT_MAX,
  centerLogoSize,
  centerTextLabel,
  layoutGeometry,
  moduleSwatch,
  type FrameStyle,
  DEFAULT_CAPTION_WEIGHT,
  unsupportedCaptionChars,
  CAPTION_FONTS,
} from "@heyqr/qr-core";
import { CircleAlertIcon, CircleSlashIcon, RotateCcwIcon, SearchIcon, ShuffleIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  captionFontOf,
  CAPTION_POSITIONS,
  CENTER_ICONS,
  defaultFrameTextColor,
  defaultLogoPlate,
  designToLayout,
  EYE_BALL_SHAPES,
  EYE_FRAME_SHAPES,
  FRAME_COMBOS,
  FRAME_PHRASES,
  FRAME_STYLES,
  FRAME_TEXT_MAX,
  hasCaptionBand,
  LOGO_PLATES,
  MODULE_SHAPES,
  QR_INKS,
  QrPreview,
  QUICK_STYLES,
  quickStylePatch,
  surpriseStyle,
  type CenterIcon,
  type EditorDesign,
  type EditorPreset,
} from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented } from "@/shared/ui/segmented";
import { Label } from "@/shared/ui/label";
import { Swatch } from "@/shared/ui/swatch";
import { BrandGroup } from "./brand-group";
import { CaptionField } from "./caption-field";
import { useFieldValidity } from "./use-field-validity";
import { CaptionSizeField } from "./caption-size-field";
import { ColorField } from "./design-panel";
import { CaptionAlignPicker, CaptionFontPicker, CaptionWeightPicker } from "./frame-panel";
import { LogoFeedback, LogoUploadTile, type LogoFeedbackState } from "./logo-upload";
import { OptionGrid } from "./option-grid";
import type { ChangeOptions } from "./use-design-history";
import { ShapeThumb } from "./shape-thumb";
import { SizePanel } from "./size-panel";

export const DESIGN_GROUPS = ["layout", "frame", "size", "pattern", "colors", "logo", "caption"] as const;
export type DesignGroup = (typeof DESIGN_GROUPS)[number] | "brand";

type Change = (patch: Partial<EditorDesign>, opts?: ChangeOptions) => void;
interface GroupProps {
  design: EditorDesign;
  onChange: Change;
  showFieldErrors?: boolean;
  onFieldValidity?: (id: string, valid: boolean) => void;
  /** The code's encoded value, for live thumbnails (frames). */
  value: string;
  logoScanMax?: number;
  /** Modules per side of the current code (scan check), for the Size panel's scan distance. */
  modules?: number;
  /** One-line confirmations (quick styles); announced politely. */
  onNotice?: (message: string) => void;
}

/*
 * Design 1.6–1.16: the Design settings, grouped as in the design (Layout, Frame, Size, Pattern, Colors, Logo, Caption).
 * Every control writes through the editor's one update path (`onChange`); the groups only arrange them.
 */
export function DesignSettings({
  group,
  onGroupChange,
  onBrandBusy,
  ...props
}: GroupProps & { group: DesignGroup; onGroupChange: (g: DesignGroup) => void; onBrandBusy?: (busy: boolean) => void }) {
  const t = useTranslations("editor.groups");
  // Design 2.5: Branded design adds the Brand group first; every other group stays available to fine-tune.
  const groups: readonly DesignGroup[] = props.design.designMode === "branded" ? ["brand", ...DESIGN_GROUPS] : DESIGN_GROUPS;
  const active = groups.includes(group) ? group : "layout";
  // The Colors group's selected role, so "Caption color" (1.16) can open Colors on the caption.
  const [colorRole, setColorRole] = useState<ColorRole>("fg");
  return (
    <TabsPrimitive.Root value={active} onValueChange={(v) => onGroupChange(v as DesignGroup)} className="flex flex-col gap-5">
      <TabsPrimitive.List
        aria-label={t("label")}
        className="-mx-4 flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 py-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {groups.map((g) => (
          <TabsPrimitive.Trigger
            key={g}
            value={g}
            className={cn(
              "inline-flex min-h-10 flex-none cursor-pointer items-center rounded-full border border-transparent px-3.5 text-[0.875rem] font-semibold text-secondary-foreground",
              "transition-[color,background-color,box-shadow] duration-(--motion-fast) hover:bg-subtle hover:text-foreground",
              "data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-[inset_0_0_0_1px_var(--accent-strong)]",
            )}
          >
            {t(g)}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {groups.map((g) => (
        <TabsPrimitive.Content
          key={g}
          value={g}
          // HEY-63: every group starts with its own controls, so the panel itself is no extra Tab stop (it would be
          // focused without a visible ring); Tab goes from the group tabs straight to the first control.
          tabIndex={-1}
          className="flex flex-col gap-6 outline-none"
        >
          {g === "brand" ? (
            <BrandGroup
              design={props.design}
              onChange={props.onChange}
              onBusy={(b) => onBrandBusy?.(b)}
              onGoTo={onGroupChange}
              onFieldValidity={props.onFieldValidity}
              value={props.value}
            />
          ) : null}
          {g === "layout" ? <LayoutGroup {...props} /> : null}
          {g === "frame" ? <FrameGroup {...props} /> : null}
          {g === "size" ? (
            <SizePanel
              design={props.design}
              onChange={props.onChange}
              showErrors={Boolean(props.showFieldErrors)}
              onValidity={props.onFieldValidity}
              modules={props.modules}
            />
          ) : null}
          {g === "pattern" ? <PatternGroup {...props} /> : null}
          {g === "colors" ? <ColorsGroup {...props} role={colorRole} onRole={setColorRole} /> : null}
          {g === "logo" ? <LogoGroup {...props} onGroupChange={onGroupChange} /> : null}
          {g === "caption" ? (
            <CaptionGroup
              {...props}
              onGroupChange={onGroupChange}
              onEditColor={() => {
                setColorRole("caption");
                onGroupChange("colors");
              }}
            />
          ) : null}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

function Section({
  title,
  hint,
  action,
  children,
  id,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="text-[0.875rem] font-bold">
          {title}
        </h3>
        {action ?? (hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null)}
      </div>
      {children}
    </section>
  );
}

/* ---------- Layout (1.12) ---------- */

const PRESET_THUMBS: Record<Exclude<EditorPreset, "frame">, ReactNode> = {
  qr: (
    <>
      <rect className="fill-foreground" x="17" y="7" width="26" height="26" rx="3" />
      <rect className="fill-muted-foreground/40" x="21" y="11" width="6" height="6" rx="1" />
      <rect className="fill-muted-foreground/40" x="33" y="11" width="6" height="6" rx="1" />
      <rect className="fill-muted-foreground/40" x="21" y="23" width="6" height="6" rx="1" />
    </>
  ),
  caption: (
    <>
      <rect className="fill-surface stroke-border" x="17" y="3" width="26" height="39" rx="3" />
      <rect className="fill-foreground" x="20" y="6" width="20" height="20" rx="2" />
      <rect className="fill-primary" x="21" y="31" width="18" height="4" rx="2" />
    </>
  ),
  vertical: (
    <>
      <rect className="fill-surface stroke-border" x="19" y="2" width="22" height="41" rx="3" />
      <circle className="fill-primary" cx="30" cy="8.5" r="3" />
      <rect className="fill-foreground" x="23" y="14" width="14" height="14" rx="1.5" />
      <rect className="fill-muted-foreground/40" x="23" y="33" width="14" height="3" rx="1.5" />
    </>
  ),
  horizontal: (
    <>
      <rect className="fill-surface stroke-border" x="5" y="9" width="50" height="27" rx="3" />
      <rect className="fill-foreground" x="9" y="13" width="19" height="19" rx="2" />
      <rect className="fill-primary" x="32" y="17" width="18" height="4" rx="2" />
      <rect className="fill-muted-foreground/40" x="32" y="24" width="12" height="3" rx="1.5" />
    </>
  ),
};

function LayoutGroup({ design, onChange, onNotice }: GroupProps) {
  const t = useTranslations("editor");
  const tq = useTranslations("editor.quickStyles");
  const tl = useTranslations("editor.layoutGroup");
  const presets = ["qr", "caption", "vertical", "horizontal"] as const;
  const dims = (preset: EditorPreset) => {
    // A card's own canvas (HEY-59 cardSize) belongs to the layout it was set on; other layouts show their own size.
    const g = layoutGeometry(designToLayout({ ...design, preset, cardSize: preset === design.preset ? design.cardSize : undefined }));
    const unit = design.size?.unit ?? "px";
    const n = (v: number) => (unit === "mm" ? Math.round(v * 10) / 10 : Math.round(v));
    return `${n(g.width)} × ${n(g.height)} ${unit}`;
  };
  const choosePreset = (preset: EditorPreset) => {
    // Switching layouts starts the card from its design proportions again (a horizontal card's 90 × 50 is not a
    // vertical card's canvas); the QR + caption layout keeps its own width and height in `size`.
    const patch: Partial<EditorDesign> = preset === design.preset ? { preset } : { preset, cardSize: undefined };
    onChange(preset !== "qr" && !design.caption.trim() ? { ...patch, caption: t("captionPlaceholder") } : patch);
  };
  const card = design.preset === "vertical" || design.preset === "horizontal";
  return (
    <>
      <Section
        title={tq("title")}
        action={
          <Button
            type="button"
            size="sm"
            variant="accent"
            onClick={() => {
              onChange(quickStylePatch(surpriseStyle(design)), { step: true });
              onNotice?.(tq("surprised"));
            }}
          >
            <ShuffleIcon aria-hidden />
            {tq("surprise")}
          </Button>
        }
      >
        {/* Design 1.12 stylechips: three columns of square swatches (the style's modules on its background), label below. */}
        <div role="group" aria-label={tq("title")} className="grid grid-cols-3 gap-2">
          {QUICK_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={tq("apply", { name: tq(`names.${s.id}`) })}
              onClick={() => {
                onChange(quickStylePatch(s), { step: true });
                onNotice?.(tq("applied", { name: tq(`names.${s.id}`) }));
              }}
              className="flex cursor-pointer flex-col items-stretch gap-1.5 rounded-lg border border-border bg-surface p-1.5 pb-2 text-start transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover hover:shadow-2"
            >
              <span className="grid aspect-square place-items-center rounded-sm p-2" style={{ backgroundColor: s.bg }}>
                <svg viewBox="3.4 3.4 5.2 5.2" aria-hidden className="size-full">
                  <path d={moduleSwatch(s.pattern)} fill={s.fg} />
                </svg>
              </span>
              <span className="px-0.5 text-[0.75rem] font-semibold">{tq(`names.${s.id}`)}</span>
            </button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground">{tq("hint")}</p>
      </Section>
      <Section title={tl("title")} hint={tl("hint")}>
        <div role="group" aria-label={t("layout")} className="grid grid-cols-2 gap-2 @[26rem]/panel:grid-cols-4">
          {presets.map((p) => (
            <OptionCard key={p} selected={design.preset === p} onClick={() => choosePreset(p)} label={t(`presets.${p}`)} meta={dims(p)}>
              <svg viewBox="0 0 60 45" aria-hidden className="h-11 w-full">
                {PRESET_THUMBS[p]}
              </svg>
            </OptionCard>
          ))}
        </div>
      </Section>
      {design.preset === "caption" || card ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-primary"
            checked={card || design.border === true}
            disabled={card}
            onChange={(e) => onChange({ border: e.target.checked })}
          />
          {tl("border")}
          {card ? <span className="text-caption text-muted-foreground">{tl("borderCards")}</span> : null}
        </label>
      ) : null}
    </>
  );
}

/** A selectable card with art, a label and optional meta (design "opt"). The check sits over the art, never the text. */
function OptionCard({
  selected,
  onClick,
  label,
  meta,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col items-stretch gap-1 rounded-lg border border-border bg-surface p-2 text-start",
        "transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover",
        "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
      )}
    >
      <SelectedMark selected={selected} />
      <span className="grid place-items-center">{children}</span>
      <span className="text-[0.8125rem] leading-tight font-semibold">{label}</span>
      {meta ? <span className="text-[0.75rem] text-muted-foreground tabular-nums">{meta}</span> : null}
    </button>
  );
}

function SelectedMark({ selected }: { selected: boolean }) {
  return selected ? (
    <span
      aria-hidden
      className="absolute end-1.5 top-1.5 z-1 grid size-5 place-items-center rounded-full bg-selected-mark text-inverse-foreground"
    >
      <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-current stroke-[3.2]">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  ) : null;
}

/* ---------- Frame (1.15) ---------- */

function FrameGroup({ design, onChange, value }: GroupProps) {
  const t = useTranslations("editor");
  const tf = useTranslations("editor.frameGroup");
  const tInks = useTranslations("home.tool.inks");
  const framed = design.preset === "frame";
  // "No frame" returns to the layout chosen before the frame (this session), else QR only.
  const [before, setBefore] = useState<EditorPreset>(framed ? "qr" : design.preset);
  if (!framed && before !== design.preset) setBefore(design.preset);
  const label = design.caption.trim() || t("captionPlaceholder");
  const frameColors = [
    ...QR_INKS.map((i) => ({ hex: i.hex, name: tInks(i.name) })),
    { hex: "#5B3BFF", name: tf("violetUi") },
    { hex: "#5F5F5F", name: tf("graphite") },
  ];
  const textColors = [{ hex: "#FFFFFF", name: tf("white") }, ...QR_INKS.map((i) => ({ hex: i.hex, name: tInks(i.name) }))];
  const frameColor = (design.frameColor ?? design.fg).toUpperCase();
  const textColor = (design.frameTextColor ?? defaultFrameTextColor(design)).toUpperCase();
  return (
    <>
      <Section title={tf("title")} hint={tf("count", { count: FRAME_STYLES.length + 1 })}>
        <div role="group" aria-label={t("frameStyle")} className="grid grid-cols-3 gap-2">
          <FrameCard selected={!framed} label={tf("none")} onClick={() => framed && onChange({ preset: before })}>
            <CircleSlashIcon aria-hidden className="size-7 text-muted-foreground" strokeWidth={1.6} />
          </FrameCard>
          {FRAME_STYLES.map((style) => (
            <FrameCard
              key={style}
              selected={framed && design.frameStyle === style}
              label={t(`frames.${style}`)}
              onClick={() =>
                onChange({ preset: "frame", frameStyle: style, caption: design.caption.trim() ? design.caption : t("captionPlaceholder") })
              }
            >
              <FrameThumb design={design} style={style} caption={label} value={value} />
            </FrameCard>
          ))}
        </div>
      </Section>
      {framed ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="caption">{tf("text")}</Label>
            <div className="relative">
              <Input
                id="caption"
                value={design.caption}
                maxLength={Math.max(FRAME_TEXT_MAX, design.caption.length)}
                aria-describedby="frame-text-hint frame-text-count"
                onChange={(e) => onChange({ caption: e.target.value.slice(0, Math.max(FRAME_TEXT_MAX, design.caption.length)) })}
                className="pe-14"
              />
              <span
                id="frame-text-count"
                className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-caption text-muted-foreground tabular-nums"
              >
                {[...design.caption].length}/{FRAME_TEXT_MAX}
              </span>
            </div>
            <p id="frame-text-hint" className="text-caption text-muted-foreground">
              {tf("textHint")}
            </p>
          </div>
          <Section title={tf("quick")}>
            <div className="flex flex-wrap gap-2">
              {FRAME_PHRASES.map((p) => (
                <Button key={p} type="button" size="sm" variant="secondary" onClick={() => onChange({ caption: tf(`phrases.${p}`) })}>
                  {tf(`phrases.${p}`)}
                </Button>
              ))}
            </div>
          </Section>
          <SwatchRow label={tf("color")} colors={frameColors} value={frameColor} onPick={(hex) => onChange({ frameColor: hex })} />
          <SwatchRow label={tf("textColor")} colors={textColors} value={textColor} onPick={(hex) => onChange({ frameTextColor: hex })} />
        </>
      ) : null}
      <Section title={tf("presets")} hint={tf("presetsHint")}>
        <div className="flex flex-wrap gap-2">
          {FRAME_COMBOS.map(([frame, code, bg]) => (
            <button
              key={`${frame}${code}${bg}`}
              type="button"
              aria-label={tf("preset", { frame, code, bg })}
              title={tf("preset", { frame, code, bg })}
              onClick={() => onChange({ frameColor: frame, fg: code, eye: undefined, eyeIn: undefined, bg, frameTextColor: undefined })}
              className="inline-flex cursor-pointer gap-0.75 rounded-md border border-border bg-surface p-1 transition-[border-color] duration-(--motion-fast) hover:border-border-hover"
            >
              {[frame, code, bg].map((c, i) => (
                <i
                  key={i}
                  className="block h-5.5 w-6.5 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(13_13_18/0.12)]"
                  style={{ backgroundColor: c }}
                />
              ))}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function FrameCard({ selected, label, onClick, children }: { selected: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-surface p-1.5 pb-2 text-start",
        "transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover",
        "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
      )}
    >
      <SelectedMark selected={selected} />
      <span className="grid aspect-square place-items-center overflow-hidden rounded-md bg-subtle p-1.5">{children}</span>
      <span className="truncate px-0.5 text-[0.75rem] font-semibold">{label}</span>
    </button>
  );
}

/** A live preview of the user's own code in one frame style (design 1.15). */
function FrameThumb({ design, style, caption, value }: { design: EditorDesign; style: FrameStyle; caption: string; value: string }) {
  const layout = useMemo(
    () => designToLayout({ ...design, preset: "frame", frameStyle: style, caption, logo: { kind: "none" }, size: undefined }),
    [design, style, caption],
  );
  return <QrPreview layout={layout} value={value} label="" className="size-full" />;
}

function SwatchRow({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: { hex: string; name: string }[];
  value: string;
  onPick: (hex: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-[0.875rem] font-bold">{label}</span>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <Swatch
            key={c.hex}
            color={c.hex}
            selected={value === c.hex.toUpperCase()}
            aria-label={c.name}
            title={c.name}
            onClick={() => onPick(c.hex)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Pattern (1.7) ---------- */

function PatternGroup({ design, onChange }: GroupProps) {
  const t = useTranslations("editor");
  const tile = (o: string, picture: ReactNode) => (
    <>
      <span className="grid h-14 place-items-center rounded-md bg-subtle">{picture}</span>
      <span className="max-w-full truncate px-0.5">{t(`shapes.${o}` as "shapes.square")}</span>
    </>
  );
  return (
    <>
      <OptionGrid
        label={t("pattern")}
        hint={t("patternHint")}
        variant="tile"
        value={design.pattern}
        options={MODULE_SHAPES}
        columns="grid-cols-4"
        onChange={(pattern) => onChange({ pattern })}
        render={(o) => tile(o, <ShapeThumb part={{ kind: "modules", shape: o }} className="size-9 text-foreground" />)}
      />
      <OptionGrid
        label={t("eyeFrame")}
        hint={t("eyeFrameHint")}
        variant="tile"
        value={design.eyeFrame}
        options={EYE_FRAME_SHAPES}
        columns="grid-cols-3"
        onChange={(eyeFrame) => onChange({ eyeFrame })}
        render={(o) => tile(o, <ShapeThumb part={{ kind: "frame", shape: o }} className="size-10" />)}
      />
      <OptionGrid
        label={t("eyeBall")}
        hint={t("eyeBallHint")}
        variant="tile"
        value={design.eyeBall}
        options={EYE_BALL_SHAPES}
        columns="grid-cols-3"
        onChange={(eyeBall) => onChange({ eyeBall })}
        render={(o) => tile(o, <ShapeThumb part={{ kind: "ball", shape: o }} className="size-10" />)}
      />
      <p className="text-caption text-muted-foreground">{t("finderNote")}</p>
    </>
  );
}

/* ---------- Colors (1.6) ---------- */

type ColorRole = "fg" | "eye" | "eyeIn" | "bg" | "frame" | "caption";
const COLOR_FIELD_ID: Record<ColorRole, string> = {
  fg: "color-fg",
  eye: "color-eye",
  eyeIn: "color-eye-in",
  bg: "color-bg",
  frame: "color-frame",
  caption: "caption-color",
};
const DEFAULT_FG = "#0D0D12";
const DEFAULT_BG = "#FFFFFF";

/** The colour a role shows, and the patch that sets or resets it. Unset roles follow the module colour (or background). */
function roleColor(d: EditorDesign, role: ColorRole): string {
  switch (role) {
    case "fg":
      return d.fg;
    case "eye":
      return d.eye ?? d.fg;
    case "eyeIn":
      return d.eyeIn ?? d.fg;
    case "bg":
      return d.bg;
    case "frame":
      return d.frameColor ?? d.fg;
    case "caption":
      return d.captionColor ?? d.fg;
  }
}
const ROLE_SET: Record<ColorRole, (hex: string) => Partial<EditorDesign>> = {
  fg: (fg) => ({ fg }),
  eye: (eye) => ({ eye }),
  eyeIn: (eyeIn) => ({ eyeIn }),
  bg: (bg) => ({ bg }),
  frame: (frameColor) => ({ frameColor }),
  caption: (captionColor) => ({ captionColor }),
};
const ROLE_RESET: Record<ColorRole, Partial<EditorDesign>> = {
  fg: { fg: DEFAULT_FG },
  eye: { eye: undefined },
  eyeIn: { eyeIn: undefined },
  bg: { bg: DEFAULT_BG },
  frame: { frameColor: undefined },
  caption: { captionColor: undefined },
};
const roleEdited = (d: EditorDesign, role: ColorRole) =>
  role === "fg"
    ? d.fg !== DEFAULT_FG
    : role === "bg"
      ? d.bg !== DEFAULT_BG
      : role === "eye"
        ? d.eye !== undefined
        : role === "eyeIn"
          ? d.eyeIn !== undefined
          : role === "frame"
            ? d.frameColor !== undefined
            : d.captionColor !== undefined;

function ColorsGroup({
  design,
  onChange,
  showFieldErrors,
  onFieldValidity,
  role,
  onRole: setRole,
}: GroupProps & { role: ColorRole; onRole: (r: ColorRole) => void }) {
  const t = useTranslations("editor.colorsGroup");
  const tInks = useTranslations("home.tool.inks");
  const roles: ColorRole[] = ["fg", "eye", "eyeIn", "bg", "frame", "caption"];
  const anyEdited = roles.some((r) => roleEdited(design, r));
  const current = roleColor(design, role).toUpperCase();
  const swatches =
    role === "bg"
      ? [
          { hex: "#FFFFFF", name: "White" },
          { hex: "#F7F1E6", name: "Cream" },
          { hex: "#EEF3FA", name: "Mist" },
          { hex: "#FBEFF2", name: "Blush" },
          { hex: "#EEF6F0", name: "Mint" },
          { hex: "#FFF6DA", name: "Butter" },
        ]
      : QR_INKS.map((i) => ({ hex: i.hex, name: tInks(i.name) }));
  return (
    <>
      <Section
        title={t("title")}
        action={
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={!anyEdited}
            onClick={() => onChange(Object.assign({}, ...roles.map((r) => ROLE_RESET[r])))}
          >
            {t("resetAll")}
          </Button>
        }
      >
        <div role="group" aria-label={t("targets")} className="flex flex-col gap-1.5">
          {roles.map((r) => {
            const hex = roleColor(design, r).toUpperCase();
            return (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-2.5 py-1.5 text-start",
                  "transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover",
                  "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
                )}
              >
                <span
                  aria-hidden
                  className="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(13_13_18/0.16)]"
                  style={{ backgroundColor: hex }}
                />
                <span className="min-w-0 grow text-[0.875rem] font-semibold">{t(`roles.${r}`)}</span>
                {roleEdited(design, r) ? (
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[0.75rem] font-semibold text-secondary-foreground">
                    {t("edited")}
                  </span>
                ) : null}
                <span className="font-mono text-[0.8125rem] text-secondary-foreground">{hex}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <div
        role="group"
        aria-label={t("editing", { role: t(`roles.${role}`) })}
        className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-3"
      >
        <span className="text-label">{t("editing", { role: t(`roles.${role}`) })}</span>
        <div role="group" aria-label={t("swatches")} className="flex flex-wrap gap-2">
          {swatches.map((s) => (
            <Swatch
              key={s.hex}
              color={s.hex}
              selected={current === s.hex}
              aria-label={s.name}
              title={s.name}
              onClick={() => onChange(ROLE_SET[role](s.hex))}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-36 grow">
            {/* Keyed by role: leaving a role with half-typed text keeps its last valid colour and clears the error. */}
            <ColorField
              key={role}
              id={COLOR_FIELD_ID[role]}
              label="HEX"
              pickerLabel={t("picker", { role: t(`roles.${role}`) })}
              value={roleColor(design, role)}
              onChange={(hex) => onChange(ROLE_SET[role](hex))}
              forceError={showFieldErrors}
              onValidity={onFieldValidity}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!roleEdited(design, role)}
            onClick={() => onChange(ROLE_RESET[role])}
            className="mb-1"
          >
            <RotateCcwIcon aria-hidden />
            {t("reset")}
          </Button>
        </div>
        {role === "frame" || role === "caption" ? (
          <p className="text-caption text-muted-foreground">{t(role === "frame" ? "frameHint" : "captionHint")}</p>
        ) : null}
      </div>
      <p className="text-caption text-muted-foreground">{t("note")}</p>
    </>
  );
}

/* ---------- Logo (1.11) ---------- */

function LogoGroup({
  design,
  onChange,
  logoScanMax,
  onGroupChange,
  onFieldValidity,
}: GroupProps & { onGroupChange: (g: DesignGroup) => void }) {
  const t = useTranslations("editor");
  const tl = useTranslations("editor.logoGroup");
  const [source, setSource] = useState<"icons" | "upload">(design.logo.kind === "image" ? "upload" : "icons");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<LogoFeedbackState>(null);
  // HEY-62: an upload is read asynchronously. If the logo changes meanwhile (Remove logo, Undo, another layout's
  // design), the newer choice wins and the finished upload is dropped.
  const latestLogo = useRef(design.logo);
  useEffect(() => {
    latestLogo.current = design.logo;
  }, [design.logo]);
  const readingFrom = useRef<EditorDesign["logo"] | null>(null);
  const onUploadFeedback = (f: LogoFeedbackState) => {
    if (f?.kind === "reading") readingFrom.current = latestLogo.current;
    setFeedback(f);
  };
  const onUploadLogo = (href: string) => {
    if (readingFrom.current !== latestLogo.current) return;
    onChange({ logo: { kind: "image", href } });
  };
  const icons = (Object.keys(CENTER_ICONS) as CenterIcon[]).filter((k) => {
    const q = query.trim().toLowerCase();
    return !q || k.includes(q) || t(`icons.${k}`).toLowerCase().includes(q);
  });
  const drawn = centerLogoSize(design.logoSize);
  const card = design.preset === "vertical" || design.preset === "horizontal";
  const onTop = design.logoPosition === "top" && design.logo.kind === "image" && card;
  const logoOn = design.logo.kind !== "none";
  // Design 1.11 / 2.x: Branded design uses the image from the Brand group; the icon library and upload are Custom only.
  const branded = design.designMode === "branded";
  return (
    <>
      {branded ? null : (
        <Segmented
          label={tl("source")}
          value={source}
          options={(["icons", "upload"] as const).map((s) => ({ value: s, label: tl(s) }))}
          onChange={setSource}
        />
      )}
      {branded ? (
        logoOn ? null : (
          <Button type="button" variant="secondary" className="self-start" onClick={() => onGroupChange("brand")}>
            {tl("brandedUpload")}
          </Button>
        )
      ) : source === "icons" ? (
        <Section title={tl("icons")} hint={tl("count", { count: Object.keys(CENTER_ICONS).length })}>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={tl("search")}
              placeholder={tl("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ps-9"
            />
          </div>
          <div role="group" aria-label={t("logo")} className="grid grid-cols-6 gap-1.5 @[26rem]/panel:grid-cols-8">
            {icons.map((key) => (
              <IconButton
                key={key}
                selected={design.logo.kind === "icon" && design.logo.icon === key}
                label={t(`icons.${key}`)}
                onClick={() => onChange({ logo: { kind: "icon", icon: key }, logoPosition: "center" })}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="size-5 fill-none stroke-current stroke-2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={CENTER_ICONS[key]} />
                </svg>
              </IconButton>
            ))}
          </div>
          {icons.length === 0 ? <p className="text-caption text-muted-foreground">{tl("empty", { query: query.trim() })}</p> : null}
          {design.logo.kind === "icon" ? (
            <Segmented
              label={tl("style")}
              value={design.logoTile === true ? "tile" : "plate"}
              options={(["plate", "tile"] as const).map((s) => ({ value: s, label: tl(s) }))}
              onChange={(s) => onChange({ logoTile: s === "tile" })}
            />
          ) : null}
          <p className="text-caption text-muted-foreground">{tl("vectorNote")}</p>
        </Section>
      ) : (
        <Section title={tl("uploadTitle")}>
          <div className="flex items-center gap-3">
            <div className="w-16 shrink-0">
              <LogoUploadTile
                selected={design.logo.kind === "image"}
                label={t("logoUpload")}
                onLogo={onUploadLogo}
                onFeedback={onUploadFeedback}
              />
            </div>
          </div>
          <LogoFeedback feedback={feedback} />
        </Section>
      )}
      {logoOn ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="logo-size">{branded ? tl("imageSize") : t("logoSize")}</Label>
              <span id="logo-size-value" className="text-caption text-muted-foreground tabular-nums">
                {logoScanMax
                  ? t("logoSizeValue", { size: Math.round(drawn * 100), max: Math.round(logoScanMax * 100) })
                  : `${Math.round(drawn * 100)}%`}
              </span>
            </div>
            <input
              id="logo-size"
              type="range"
              min={CENTER_LOGO_SIZE.min}
              max={CENTER_LOGO_SIZE.max}
              step={0.01}
              value={drawn}
              disabled={onTop}
              aria-describedby={`logo-size-value${design.logoSize > CENTER_LOGO_SIZE.max ? " logo-size-legacy" : ""}`}
              onChange={(e) => onChange({ logoSize: Number(e.target.value) })}
              className="h-11 w-full touch-pan-y accent-primary disabled:opacity-40"
            />
            {design.logoSize > CENTER_LOGO_SIZE.max ? (
              <p id="logo-size-legacy" className="text-caption text-muted-foreground">
                {t("logoSizeLegacy", { saved: Math.round(design.logoSize * 100), max: Math.round(CENTER_LOGO_SIZE.max * 100) })}
              </p>
            ) : null}
          </div>
          {design.logoTile && design.logo.kind === "icon" ? null : (
            <Section title={t("logoPlate.label")}>
              <Segmented
                label={t("logoPlate.label")}
                value={design.logoPlate ?? defaultLogoPlate(design.logo)}
                options={LOGO_PLATES.map((o) => ({ value: o, label: t(`logoPlate.${o}`) }))}
                onChange={(logoPlate) => onChange({ logoPlate })}
              />
              <p className="text-caption text-muted-foreground">{tl("backingHint")}</p>
            </Section>
          )}
          {/* Design 1.11: Position is always shown; "Top of card" needs a card layout and an uploaded image. */}
          <Section title={tl("position")}>
            <Segmented
              label={tl("position")}
              value={onTop ? "top" : "center"}
              options={[
                { value: "center" as const, label: tl("positions.center") },
                { value: "top" as const, label: tl("positions.top"), disabled: !card || design.logo.kind !== "image" },
              ]}
              onChange={(logoPosition) => onChange({ logoPosition })}
            />
            {!card ? <p className="text-caption text-muted-foreground">{tl("positionHint")}</p> : null}
            {onTop ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="brand-name">{tl("brandName")}</Label>
                <BrandNameField design={design} onChange={onChange} onValidity={onFieldValidity} hint={tl("brandNameHint")} />
              </div>
            ) : null}
          </Section>
          {branded ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => onChange({ logo: { kind: "none" }, logoPosition: "center" })}
            >
              <Trash2Icon aria-hidden />
              {tl("remove")}
            </Button>
          )}
        </>
      ) : null}
    </>
  );
}

/** The brand card's name (design 2.8). HEY-181: characters the caption font can't draw are flagged and block Export. */
function BrandNameField({
  design,
  onChange,
  onValidity,
  hint,
}: Pick<GroupProps, "design" | "onChange"> & { onValidity?: (id: string, valid: boolean) => void; hint: string }) {
  const t = useTranslations("editor.captionField");
  const font = captionFontOf(design);
  const missing = unsupportedCaptionChars({
    preset: "qr",
    caption: { text: "", font, weight: 700 },
    brandName: design.brandName ?? "",
    topLogoHref: "brand",
  });
  useFieldValidity("brand-name", missing.length === 0, onValidity);
  return (
    <>
      <Input
        id="brand-name"
        value={design.brandName ?? ""}
        maxLength={40}
        aria-invalid={missing.length > 0 || undefined}
        aria-describedby="brand-name-hint"
        onChange={(e) => onChange({ brandName: e.target.value })}
      />
      {missing.length ? (
        <p id="brand-name-hint" role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t("unsupported", {
              font: font ? CAPTION_FONTS[font].label : "DM Sans",
              chars: missing.slice(0, 8).join(" "),
              count: missing.length,
            })}
          </span>
        </p>
      ) : (
        <p id="brand-name-hint" className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </>
  );
}

function IconButton({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid aspect-square cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover",
        "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Caption (1.16) ---------- */

function CaptionGroup({
  design,
  onChange,
  onFieldValidity,
  onGroupChange,
  onEditColor,
}: GroupProps & { onGroupChange: (g: DesignGroup) => void; onEditColor: () => void }) {
  const t = useTranslations("editor");
  const tc = useTranslations("editor.captionGroup");
  if (design.preset === "frame")
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-secondary-foreground">{tc("frameNote")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => onGroupChange("frame")}>
          {t("groups.frame")}
        </Button>
      </div>
    );
  if (!hasCaptionBand(design.preset))
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-secondary-foreground">{tc("hiddenNote", { layout: t(`presets.${design.preset}`) })}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(design.caption.trim() ? { preset: "caption" } : { preset: "caption", caption: t("captionPlaceholder") })}
        >
          {tc("toLayout")}
        </Button>
      </div>
    );
  const inside = centerTextLabel(design.caption);
  const captionColor = (design.captionColor ?? design.fg).toUpperCase();
  return (
    <>
      <CaptionField
        id="caption"
        label={t("captionField.label")}
        value={design.caption}
        onAccept={(caption) => onChange({ caption })}
        onValidity={onFieldValidity}
        font={captionFontOf(design)}
        weight={design.captionWeight ?? DEFAULT_CAPTION_WEIGHT}
      />
      <CaptionFontPicker design={design} onChange={onChange} withWeight={false} />
      {/* Design 1.16: Size beside Weight, Align beside Position, then the caption color row. */}
      <div className="grid grid-cols-2 items-start gap-3">
        <CaptionSizeField design={design} onChange={onChange} onValidity={onFieldValidity} />
        <CaptionWeightPicker design={design} onChange={onChange} />
      </div>
      <div className="grid grid-cols-2 items-start gap-3">
        <CaptionAlignPicker design={design} onChange={onChange} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-label">{tc("position")}</span>
          <Segmented
            label={tc("position")}
            value={design.captionPosition ?? "below"}
            options={CAPTION_POSITIONS.map((p) => ({ value: p, label: tc(`positions.${p}`) }))}
            onChange={(captionPosition) => onChange({ captionPosition })}
          />
        </div>
      </div>
      {design.captionPosition === "inside" ? <p className="-mt-3 text-caption text-muted-foreground">{tc("insideHint")}</p> : null}
      {design.captionPosition === "inside" && inside.shortened ? (
        <p role="status" className="-mt-3 flex items-start gap-1.5 text-caption font-medium text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {tc("insideShortened", { max: CENTER_TEXT_MAX, shown: inside.label })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onEditColor}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-2.5 py-1.5 text-start transition-[border-color] duration-(--motion-fast) hover:border-border-hover"
      >
        <span aria-hidden className="size-7 shrink-0 rounded-sm border border-border" style={{ backgroundColor: captionColor }} />
        <span className="grow text-label">{tc("color")}</span>
        <span className="font-mono text-caption text-muted-foreground">{captionColor}</span>
      </button>
    </>
  );
}
