import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // HEY-166: workspace tests use @simplex-packages/heyqr-sdk's TypeScript source (its entry), not the built dist.
      { find: /^@simplex-packages\/heyqr-sdk$/, replacement: fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)) },
      {
        find: /^@simplex-packages\/heyqr-sdk\/react$/,
        replacement: fileURLToPath(new URL("./packages/sdk/src/react/index.tsx", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
