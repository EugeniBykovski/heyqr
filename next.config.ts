import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components stays off until the data layer is stable (see docs/adr/0003-rendering-and-caching.md).
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@resvg/resvg-js", "zxing-wasm"],
  transpilePackages: ["@heyqr/qr-core"],
  // Caption fonts read from disk by the PNG export (src/server/qr/export.ts).
  outputFileTracingIncludes: { "/api/export/[layoutId]": ["./packages/qr-core/fonts/**"] },
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
