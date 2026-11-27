import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolveAppEnv } from "./src/shared/config/app-env";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// HEY-175: the browser reports the same environment and release as the server (src/instrumentation.ts).
const browserMonitoring = {
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || resolveAppEnv(),
  NEXT_PUBLIC_SENTRY_RELEASE:
    process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "",
};

const nextConfig: NextConfig = {
  env: browserMonitoring,
  // Cache Components stays off until the data layer is stable (see docs/adr/0003-rendering-and-caching.md).
  reactStrictMode: true,
  poweredByHeader: false,
  // pdfkit reads its font metrics (data/*.afm) from its own folder at runtime, so it must not be bundled.
  // HEY-188: lcms-wasm loads its lcms.wasm next to itself at runtime, so it stays an external package too.
  serverExternalPackages: ["@resvg/resvg-js", "zxing-wasm", "pdfkit", "svg-to-pdfkit", "lcms-wasm"],
  transpilePackages: ["@heyqr/qr-core"],
  // Caption fonts read from disk by the export (src/server/qr/export.ts): PNG rasterizing and SVG embedding.
  // HEY-188: the bundled ICC profiles (assets/icc) and Little CMS's WebAssembly, read by the print routes.
  outputFileTracingIncludes: {
    "/api/export/[layoutId]": ["./public/caption-fonts/*.ttf"],
    "/api/print/files/[layoutId]": ["./public/caption-fonts/*.ttf", "./assets/icc/*.icc", "./node_modules/lcms-wasm/dist/lcms.wasm"],
    "/api/print/preview": ["./assets/icc/*.icc", "./node_modules/lcms-wasm/dist/lcms.wasm"],
    "/api/print/sample": ["./public/caption-fonts/*.ttf"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.amazonaws.com" },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
