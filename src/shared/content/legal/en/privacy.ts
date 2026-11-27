import type { LegalDocument } from "../types";

/**
 * HEY-193 draft Privacy Policy, written from a code and configuration audit (docs/legal/REVIEW.md lists the evidence
 * for each statement and the open items). Effective 2026-11-27 (HEY-188); the [[…]] facts await the owner.
 */
export const privacy: LegalDocument = {
  id: "privacy",
  title: "Privacy Policy",
  updated: "2026-11-27",
  effective: "2026-11-27",
  intro:
    "This policy explains what HeyQR collects, why, who else receives it and what you can do about it. The controller is [[legal name and registered address of the company that runs HeyQR]].",
  sections: [
    {
      id: "collect",
      title: "What we collect",
      blocks: [
        {
          list: [
            "Account: your name, email address and profile picture from Google, Google’s account ID for you, and the sign-in tokens Google returns.",
            "Sign-in sessions: each session’s IP address and browser user agent, as recorded at sign-in, and when it expires.",
            "Your codes: content (addresses, text, Wi-Fi details, contact cards, events and so on), destinations, designs, layouts, names, and the files you upload (logos, photos, PDFs).",
            "Purchases and plans: what you bought, amounts, currency, status, the Stripe IDs of your customer, payments and subscription, credits, and trial dates. Card details go to Stripe; HeyQR never receives them.",
            "Scans: for each Dynamic code, a count of scans per day. Nothing about the person scanning is stored: no IP address, device, location, cookie or referrer.",
            "Developer API: API keys (only a lookup ID and a one-way hash of the secret), when each was last used, per-minute request counts and recent request results for safe retries.",
            "Reports about a hosted page: the reason, any details and email address you give, and a one-way hash of your IP address used only to limit repeated reports.",
            "Release updates and docs feedback: the email address you give for release news, and anonymous yes/no answers to “Was this page helpful?”.",
          ],
        },
      ],
    },
    {
      id: "use",
      title: "Why we use it",
      blocks: [
        {
          list: [
            "to sign you in and keep you signed in;",
            "to store, render and serve your codes, files and hosted pages, and to redirect Dynamic codes;",
            "to take payments, unlock what you bought, run plans and trials, and send purchase receipts;",
            "to show you your scan counts;",
            "to review reports and keep the service safe;",
            "to find and fix errors.",
          ],
        },
        "HeyQR doesn’t sell personal data, show ads or build advertising profiles. [[legal bases for each purpose, where the law requires them]]",
      ],
    },
    {
      id: "public",
      title: "What other people can see",
      blocks: [
        "A static code carries its content in the pattern, so anyone who scans it can read it. A Dynamic code’s short link leads anyone who scans it to its destination. A published hosted page, with its photos and files, is public to anyone who has the link. Drafts, unpublished changes, your account details and your scan counts are private.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies and browser storage",
      blocks: [
        {
          list: [
            "Sign-in cookies (Better Auth): keep you signed in. They are set only when you sign in.",
            "NEXT_LOCALE: remembers the language you chose.",
            "Browser storage (localStorage): keeps a guest’s design in this browser until you sign in, unsaved layout edits for recovery, and editor view preferences. It stays on your device.",
          ],
        },
        "HeyQR uses no advertising or analytics cookies.",
      ],
    },
    {
      id: "providers",
      title: "Who else receives data",
      blocks: [
        "HeyQR uses these providers to run the service. Each receives only what its job needs:",
        {
          list: [
            "Google: sign-in.",
            "Stripe: payments and subscriptions; it receives your email address, HeyQR’s account ID for you and what you’re buying.",
            "Vercel: hosts the website.",
            "Neon: hosts the database, in AWS us-east-2 (Ohio, United States).",
            "[[Cloudflare R2 or AWS S3]]: stores uploaded and paid files.",
            "Resend: sends purchase receipt emails (your name, email address, the amount and a link to your code).",
            "Sentry: error reports. It is set up to send no user details, cookies, request headers, bodies or query strings, and IDs and secrets are removed before an error is sent.",
          ],
        },
        "Some of these providers process data outside your country. [[international transfer safeguards]]",
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      blocks: [
        "Account data, codes and purchase records are kept while your account exists. A deleted code is kept so you can undo the deletion. [[how long deleted codes are kept before permanent removal]] Uploaded logo files that no saved design uses are removed automatically after 24 hours.",
        "[[retention periods for sessions, billing records, reports and release-update emails]]",
      ],
    },
    {
      id: "rights",
      title: "Your choices and rights",
      blocks: [
        "You can change or delete your codes in My QR codes, cancel a plan in Plan & billing, revoke API keys, and clear this browser’s storage at any time.",
        "To get a copy of your data, correct it or delete your account, write to [[privacy contact email address]]. Account deletion isn’t available in the app yet, so these requests are handled by email. [[response time and the rights that apply to users, including the right to complain to a supervisory authority]]",
      ],
    },
    {
      id: "contact",
      title: "Changes and contact",
      blocks: [
        "If this policy changes in a way that matters to you, HeyQR will tell you before the change takes effect.",
        "Privacy questions: [[privacy contact email address]]. [[data protection officer or EU/UK representative, if required]]",
      ],
    },
  ],
};
