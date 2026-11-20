import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components stays off until the data layer is stable (see docs/adr/0003-rendering-and-caching.md).
  reactStrictMode: true,
  poweredByHeader: false,
  // pdfkit reads its font metrics (data/*.afm) from its own folder at runtime, so it must not be bundled.
  serverExternalPackages: ["@resvg/resvg-js", "zxing-wasm", "pdfkit", "svg-to-pdfkit"],
  transpilePackages: ["@heyqr/qr-core"],
  // Caption fonts read from disk by the export (src/server/qr/export.ts): PNG rasterizing and SVG embedding.
  outputFileTracingIncludes: {
    "/api/export/[layoutId]": ["./public/caption-fonts/*.ttf"],
    "/api/print/files/[layoutId]": ["./public/caption-fonts/*.ttf"],
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
