/**
 * HEY-191 QA: prints the shared Button's class string for every variant and size (JSON), so a browser check can render
 * the real component styles on a live page and read their computed values.  pnpm exec tsx scripts/qa/button-classes.ts
 */
import { buttonVariants } from "../../src/shared/ui/button";

const variants = ["primary", "secondary", "accent", "ghost", "link", "danger", "danger-solid", "ghost-danger"] as const;
const sizes = ["sm", "md", "lg", "icon", "icon-sm"] as const;
const out: Record<string, string> = {};
for (const variant of variants) for (const size of sizes) out[`${variant}/${size}`] = buttonVariants({ variant, size });
console.log(JSON.stringify(out));
