import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // HEY-166: workspace tests use @heyqr/sdk's TypeScript source (its entry), not the built dist.
      { find: /^@heyqr\/sdk$/, replacement: fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)) },
      { find: /^@heyqr\/sdk\/react$/, replacement: fileURLToPath(new URL("./packages/sdk/src/react/index.tsx", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
