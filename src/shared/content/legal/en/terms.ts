import type { LegalDocument } from "../types";

/** HEY-193 draft Terms of Service, written from the product's behaviour (docs/legal/REVIEW.md). Not yet approved. */
export const terms: LegalDocument = {
  id: "terms",
  title: "Terms of Service",
  updated: "2026-11-26",
  intro:
    "These terms cover your use of HeyQR at www.heyqr.me: designing, buying and downloading QR codes, Dynamic codes and hosted pages, plans and trials, and the developer API. HeyQR is provided by [[legal name and registered address of the company that runs HeyQR]].",
  sections: [
    {
      id: "account",
      title: "Your account",
      blocks: [
        "You can design and preview codes without an account. To download a file, buy a plan or manage codes you sign in with Google; HeyQR doesn’t offer password sign-in.",
        "You are responsible for what happens in your account and for keeping access to your Google account secure. Tell us at [[support email address]] if you think someone else has used it.",
        "You must be [[minimum age]] or older and able to agree to these terms.",
      ],
    },
    {
      id: "content",
      title: "Your codes and content",
      blocks: [
        "You keep every right you have in what you add: addresses, text, contact details, logos, photos, PDFs, captions and designs. You give HeyQR the permission it needs to store, render and serve that content to run the service, including showing your published hosted pages to anyone who scans the code.",
        "You confirm that you may use what you upload and that a code’s content and destination are lawful.",
        "A static code holds its content in the pattern itself. Once downloaded, it works without HeyQR, and HeyQR can’t change or switch it off.",
      ],
    },
    {
      id: "buying",
      title: "Buying downloads",
      blocks: [
        "Designing, previewing and the scan check are free. You pay when you download.",
        {
          list: [
            "A Single QR is a one-time payment per code, plus any tax Stripe adds at checkout. It includes the PNG and SVG of every layout of that code, unlimited re-downloads and design edits. Nothing renews.",
            "Static Packs are credits for unlocking static codes. They don’t expire.",
            "A Print Pack adds print-ready files for a layout measured in millimetres.",
          ],
        },
        "Prices are shown before you pay, in the currency you’ll be charged. Payment is handled by Stripe. A purchase is unlocked only after Stripe confirms the payment to HeyQR.",
      ],
    },
    {
      id: "dynamic",
      title: "Dynamic codes and hosted pages",
      blocks: [
        "A Dynamic code holds a permanent short link at www.heyqr.me/r/… that you can point somewhere else after printing. Hosted pages (menu, coupon, social links, business, apps, PDF and product) are pages HeyQR hosts behind a Dynamic code. Only what you publish is shown to people who scan; drafts stay private.",
        "Dynamic codes and hosted pages need an active plan or trial. While you have one, the short link redirects or shows your page.",
        "When a plan ends, its Dynamic codes show a neutral “not active right now” page instead of redirecting, and their files can’t be downloaded. Their short links, destinations, designs and scan counts are kept. If you subscribe again, the same printed codes work again. Codes you paused or deleted stay that way.",
        "HeyQR aims to keep short links and hosted pages available but doesn’t promise uninterrupted service. [[service availability commitment, if any]]",
      ],
    },
    {
      id: "plans",
      title: "Plans, trials and cancellation",
      blocks: [
        "The Starter and Studio plans are monthly subscriptions. They renew automatically each month until you cancel. Each plan includes a number of live Dynamic codes and static unlocks a month, as shown on Pricing.",
        "The trial lasts 7 days, needs no card and never charges you. It includes one test Dynamic code with a real short link. When it ends, that code stops redirecting unless you choose a plan.",
        "You can cancel anytime from Plan & billing (Manage subscription). Cancellation takes effect at the end of the period you’ve paid for: until then everything keeps working, and before that date you can keep your plan from Plan & billing.",
      ],
    },
    {
      id: "refunds",
      title: "Refunds",
      blocks: [
        "[[refund policy: when refunds are given, how to ask, and any statutory withdrawal right that applies to buyers]]",
        "When HeyQR refunds a payment, what that payment unlocked is removed from your account: the code’s paid files, credits or plan access it granted.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        "Don’t use HeyQR for anything unlawful or harmful. In particular, codes and hosted pages must not:",
        {
          list: [
            "lead to phishing, malware, scams or other deception;",
            "infringe someone else’s rights, including trademarks and copyright;",
            "contain illegal, hateful or sexually explicit content, or harass anyone;",
            "be used to send spam or to get around another service’s rules.",
          ],
        },
        "Don’t interfere with the service: no attempts to break its security, overload it or read other people’s data. The developer API has rate limits; use your API keys only on your own server and keep them secret.",
      ],
    },
    {
      id: "moderation",
      title: "Reports and moderation",
      blocks: [
        "Anyone can report a hosted page with “Report this page”. HeyQR reviews reports and may take a page down when it breaks these terms. A taken-down page is unavailable to everyone who scans it, and you see why in your account. Taking a page down doesn’t delete your code.",
        "HeyQR may suspend or close accounts that seriously or repeatedly break these terms. [[notice and appeal process]]",
      ],
    },
    {
      id: "liability",
      title: "Liability",
      blocks: [
        "Check that a code scans and points where you mean before you print it: the scan check helps, but it isn’t a guarantee for every printer, material or phone.",
        "[[limitation of liability and warranty disclaimers, as approved by counsel]]",
      ],
    },
    {
      id: "changes",
      title: "Changes, law and contact",
      blocks: [
        "If these terms change in a way that matters to you, HeyQR will tell you before the change takes effect. [[notice period]]",
        "These terms are governed by [[governing law and courts]].",
        "Questions about these terms: [[support email address]].",
      ],
    },
  ],
};
