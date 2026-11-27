/*
 * /developers release status (design 12.1 "Not on npm yet" / 12.2 "Live"). The registry commands and npm links show
 * only once a package is actually on npm; flip `published` in the release that publishes it.
 */
export const PACKAGE_RELEASE = {
  qrCore: { name: "@heyqr/qr-core", version: "0.1.0", published: false },
  // HEY-173: 0.1.0 is `latest` on the public registry, installs without credentials and its README Quickstart passed.
  sdk: { name: "@simplex-packages/heyqr-sdk", version: "0.1.0", published: true },
} as const;

export const npmUrl = (name: string) => `https://www.npmjs.com/package/${name}`;
