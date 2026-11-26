"use client";

import { ArrowRightIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

export type CompareCell = { kind: "yes" } | { kind: "no" } | { kind: "na" } | { kind: "text"; text: string; note?: string };
export type ComparePlan = {
  id: string;
  name: string;
  /** How it's paid: Free, One-time purchase, Credits, Monthly subscription. */
  model: string;
  /** One price, or one per quantity (Static Packs: each credit amount with its own price, e.g. "for 3 credits"). */
  prices: { price: string; unit?: string }[];
  highlight?: boolean;
};
export type CompareRow = { id: string; label: string; hint?: string; cells: CompareCell[] };
export type PlanCompareProps = {
  plans: ComparePlan[];
  rows: CompareRow[];
  /** The two plans shown side by side below 640 px. */
  initialPair: [string, string];
  labels: { feature: string; region: string; more: string; pick: [string, string]; yes: string; no: string; na: string };
};

/*
 * Pricing "Compare" (HEY-72): every offer and feature from the catalog. From 640 px one table with a sticky feature
 * column; when the five plans don't fit, the table scrolls sideways inside its own focusable region and says more
 * plans follow. Below 640 px the feature column and two plans the visitor picks, compared side by side.
 */
export function PlanCompare({ plans, rows, initialPair, labels }: PlanCompareProps) {
  const [pair, setPair] = useState(initialPair);
  const pick = (slot: 0 | 1, id: string) =>
    setPair((p) => {
      const other = slot ? 0 : 1;
      // Two distinct offers: choosing the other side's plan swaps the two.
      const next: [string, string] = [...p];
      if (id === p[other]) next[other] = p[slot];
      next[slot] = id;
      return next;
    });
  const index = (id: string) =>
    Math.max(
      0,
      plans.findIndex((p) => p.id === id),
    );
  const shown = pair.map(index);
  const ids = useId();

  return (
    <>
      <div className="max-sm:hidden">
        <ScrollTable labels={labels} plans={plans} rows={rows} columns={plans.map((_, i) => i)} />
      </div>
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="grid grid-cols-2 gap-2.5">
          {([0, 1] as const).map((slot) => (
            <div key={slot} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${ids}-${slot}`} className="text-caption font-semibold text-secondary-foreground">
                {labels.pick[slot]}
              </label>
              <div className="relative">
                <select
                  id={`${ids}-${slot}`}
                  value={pair[slot]}
                  onChange={(e) => pick(slot, e.target.value)}
                  className={cn(
                    "min-h-11 w-full cursor-pointer appearance-none rounded-md border border-border bg-surface py-2 ps-3 pe-9 text-body font-semibold",
                    "hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring-soft",
                  )}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon
                  aria-hidden
                  className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
          <Table labels={labels} plans={plans} rows={rows} columns={shown} compact />
        </div>
      </div>
    </>
  );
}

function ScrollTable(props: TableProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** overflow: the plans don't all fit; more: some are still to the right. */
  const [scroll, setScroll] = useState({ overflow: false, more: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    const more = overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setScroll((s) => (s.overflow === overflow && s.more === more ? s : { overflow, more }));
  }, []);
  const { overflow, more } = scroll;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const hint = useId();

  return (
    <div className="flex flex-col gap-2">
      {overflow ? (
        <p
          id={hint}
          aria-hidden={!more}
          className={cn(
            "flex items-center justify-end gap-1.5 self-end text-caption font-semibold text-secondary-foreground transition-opacity",
            !more && "opacity-0",
          )}
        >
          {props.labels.more}
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </p>
      ) : null}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
        <div
          ref={ref}
          role="region"
          aria-label={props.labels.region}
          aria-describedby={more ? hint : undefined}
          // A tab stop only while there is something to scroll with the arrow keys.
          tabIndex={overflow ? 0 : undefined}
          className="overflow-x-auto focus-visible:outline-none"
        >
          <Table {...props} />
        </div>
        {/* More columns to the right: a soft edge over the cut-off column. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 end-0 w-12 bg-linear-to-l from-surface to-transparent transition-opacity",
            more ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
}

type TableProps = Omit<PlanCompareProps, "initialPair"> & { columns: number[]; compact?: boolean };

function Table({ plans, rows, columns, labels, compact }: TableProps) {
  const pad = compact ? "px-2.5 py-3" : "px-4 py-3.5";
  const sticky = !compact && "sticky start-0 z-1 bg-surface";
  return (
    <table className={cn("w-full table-fixed border-separate border-spacing-0 text-[0.875rem]", compact ? "" : "min-w-[64rem]")}>
      <colgroup>
        <col className={compact ? "w-[32%]" : "w-48"} />
        {columns.map((c) => (
          <col key={plans[c]?.id} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className={cn(pad, sticky, "text-start align-bottom text-caption font-semibold text-muted-foreground")}>
            {labels.feature}
          </th>
          {columns.map((c) => {
            const plan = plans[c];
            if (!plan) return null;
            return (
              <th
                key={plan.id}
                scope="col"
                className={cn(
                  compact ? "px-2.5 pt-3.5 pb-3" : "px-4 pt-5 pb-4",
                  "text-start align-top font-normal",
                  plan.highlight && "bg-accent",
                )}
              >
                <span className="block text-caption font-medium text-muted-foreground">{plan.model}</span>
                <span className="mt-1 block text-[1rem] leading-tight font-semibold text-foreground">{plan.name}</span>
                <span className={cn("mt-2 flex flex-col", plan.prices.length > 1 ? "gap-2" : "gap-1")}>
                  {plan.prices.map((p) => (
                    <span
                      key={`${p.price}${p.unit ?? ""}`}
                      // Several quantities (Static Packs), or the narrow two-plan view: each price sits over its interval or amount,
                      // the same in every currency.
                      className={cn("flex items-baseline gap-x-1.5", plan.prices.length > 1 || compact ? "flex-col" : "flex-wrap")}
                    >
                      <b className="text-[1.25rem] leading-tight font-semibold tracking-[-0.02em] text-foreground tabular-nums">
                        {p.price}
                      </b>
                      {p.unit ? <span className="text-caption text-secondary-foreground">{p.unit}</span> : null}
                    </span>
                  ))}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row" className={cn(pad, sticky, "border-t border-border text-start align-top font-semibold")}>
              {row.label}
              {row.hint ? <span className="mt-0.5 block text-caption font-normal text-muted-foreground">{row.hint}</span> : null}
            </th>
            {columns.map((c) => (
              <td
                key={plans[c]?.id}
                className={cn(pad, "border-t border-border text-start align-top break-words", plans[c]?.highlight && "bg-accent/45")}
              >
                <Cell cell={row.cells[c] ?? { kind: "no" }} labels={labels} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell({ cell, labels }: { cell: CompareCell; labels: PlanCompareProps["labels"] }) {
  if (cell.kind === "yes")
    return (
      <>
        <CheckIcon aria-hidden className="size-4.5 text-accent-text" />
        <span className="sr-only">{labels.yes}</span>
      </>
    );
  if (cell.kind === "no" || cell.kind === "na")
    return (
      <>
        <span aria-hidden className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">{cell.kind === "no" ? labels.no : labels.na}</span>
      </>
    );
  return (
    <>
      <span className="text-foreground">{cell.text}</span>
      {cell.note ? <span className="mt-0.5 block text-caption text-muted-foreground">{cell.note}</span> : null}
    </>
  );
}
