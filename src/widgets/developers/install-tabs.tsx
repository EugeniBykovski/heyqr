"use client";

import { useState } from "react";
import { Segmented } from "@/shared/ui/segmented";
import { CodeBlock } from "./code-block";

/** Design 12.2: npm / pnpm / Yarn install commands (shown only once the package is on npm). */
export function InstallTabs({
  commands,
  label,
  copyLabel,
  copiedLabel,
}: {
  commands: Record<"npm" | "pnpm" | "yarn", string>;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [pm, setPm] = useState<"npm" | "pnpm" | "yarn">("npm");
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented
        label={label}
        className="max-w-80"
        value={pm}
        options={[
          { value: "npm", label: "npm" },
          { value: "pnpm", label: "pnpm" },
          { value: "yarn", label: "Yarn" },
        ]}
        onChange={setPm}
      />
      <CodeBlock name="terminal" code={commands[pm]} prompt copyLabel={copyLabel} copiedLabel={copiedLabel} />
    </div>
  );
}
