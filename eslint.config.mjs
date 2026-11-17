import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Localized navigation keeps the language in the URL.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next/link", message: "Use Link from @/i18n/navigation." },
            { name: "next/navigation", importNames: ["useRouter", "usePathname", "redirect"], message: "Use @/i18n/navigation." },
          ],
        },
      ],
      // Styling goes through design tokens: no hex colors in className (bg-[#5B3BFF]); use bg-primary etc.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/\\[#[0-9a-fA-F]{3,8}/]",
          message: "Use a semantic color token (bg-primary, text-muted-foreground…) instead of a hex value.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|purple|fuchsia|pink|rose)-\\d/]",
          message: "Default Tailwind palette is off-limits; use Hey QR tokens.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    "packages/*/dist/**",
  ]),
]);

export default eslintConfig;
