// Builds the public web pages Google Play needs (privacy policy, terms, account deletion, a home
// page) into ../public-site/ from the same legal/*.md the app bundles. Plain HTML + one CSS file:
// no scripts, no web fonts, no trackers, so the folder can be uploaded as-is to any static host
// (docs/play-store/hosting.md).
//
//   node scripts/build-public-site.js            build (scripts/build-legal.js also runs this)
//   node scripts/build-public-site.js --strict   build, then fail if a [PLACEHOLDER] is left
//
// Before publishing, set the two values below (or pass them as environment variables):
//   LATELY_SUPPORT_EMAIL   the support email on the Play listing
//   LATELY_DELETION_DAYS   how many days an emailed deletion request may take (a number)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const OUT = path.join(root, "..", "public-site");

const SITE = {
  appName: "Lately",
  // Must match the app name on the Play listing (docs/play-store/listing.md).
  listingTitle: "Lately: Find Saved Reels",
  playUrl: "https://play.google.com/store/apps/details?id=app.lately.android",
  supportEmail: process.env.LATELY_SUPPORT_EMAIL || "[SUPPORT EMAIL]",
  deletionDays: process.env.LATELY_DELETION_DAYS || "[DAYS]",
};

// ------------------------------------------------------------------ markdown --
// The same subset, parsed the same way, as src/legal/markdown.ts (keep the two in step):
// "# " and "## " headings, paragraphs (lines joined with a space), "- " bullets, **bold** runs.

function runs(line) {
  return line
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false },
    );
}

function parseMarkdown(md) {
  const blocks = [];
  let para = [];
  const endPara = () => {
    if (para.length) blocks.push({ kind: "p", text: runs(para.join(" ")) });
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      endPara();
    } else if (line.startsWith("## ")) {
      endPara();
      blocks.push({ kind: "h2", text: runs(line.slice(3)) });
    } else if (line.startsWith("# ")) {
      endPara();
      blocks.push({ kind: "h1", text: runs(line.slice(2)) });
    } else if (line.startsWith("- ")) {
      endPara();
      blocks.push({ kind: "li", text: runs(line.slice(2)) });
    } else {
      para.push(line);
    }
  }
  endPara();
  return blocks;
}

// ---------------------------------------------------------------------- html --

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const plain = (text) => text.map((r) => r.text).join("");
const inline = (text) => text.map((r) => (r.bold ? `<strong>${escapeHtml(r.text)}</strong>` : escapeHtml(r.text))).join("");

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Markdown blocks as HTML; h2s get ids so a section can be linked (Play asks for that). */
function blocksToHtml(blocks) {
  const out = [];
  let inList = false;
  for (const b of blocks) {
    if (b.kind !== "li" && inList) {
      out.push("</ul>");
      inList = false;
    }
    if (b.kind === "h1") out.push(`<h1>${inline(b.text)}</h1>`);
    else if (b.kind === "h2") out.push(`<h2 id="${slug(plain(b.text))}">${inline(b.text)}</h2>`);
    else if (b.kind === "p") {
      const cls = plain(b.text).startsWith("Last updated") ? ' class="updated"' : "";
      out.push(`<p${cls}>${inline(b.text)}</p>`);
    } else {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${inline(b.text)}</li>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const isPlaceholder = (v) => /^\[.*\]$/.test(v);

/** The support email as a mailto link, or as plain text while it is still a placeholder. */
function emailHtml() {
  const e = SITE.supportEmail;
  return isPlaceholder(e) ? escapeHtml(e) : `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`;
}

const NAV = [
  { href: "index.html", label: "Home" },
  { href: "privacy.html", label: "Privacy" },
  { href: "terms.html", label: "Terms" },
  { href: "delete-account.html", label: "Delete account" },
];

function page({ file, title, description, body }) {
  const nav = NAV.map(
    (n) => `<li><a href="${n.href}"${n.href === file ? ' aria-current="page"' : ""}>${escapeHtml(n.label)}</a></li>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
<div class="wrap">
<a class="brand" href="index.html">${escapeHtml(SITE.appName)}</a>
<nav aria-label="Pages"><ul>${nav}</ul></nav>
</div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="site">
<div class="wrap">
<p>Questions or requests about your data: ${emailHtml()}</p>
<p>${escapeHtml(SITE.appName)} is not affiliated with Instagram or Meta.</p>
</div>
</footer>
</body>
</html>
`;
}

// --------------------------------------------------------------------- pages --

function legalPage(doc, title, description, intro) {
  const md = fs.readFileSync(path.join(root, "legal", `${doc}.md`), "utf8").replace(/\r\n/g, "\n");
  const blocks = parseMarkdown(md);
  const sections = blocks.filter((b) => b.kind === "h2");
  const toc = `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${sections
    .map((s) => `<li><a href="#${slug(plain(s.text))}">${inline(s.text)}</a></li>`)
    .join("")}</ul></nav>`;
  // Heading, "Last updated", then the deletion pointer and the table of contents.
  const head = blocks.slice(0, 2);
  const rest = blocks.slice(2);
  const body = [blocksToHtml(head), intro || "", toc, blocksToHtml(rest)].filter(Boolean).join("\n");
  return page({ file: `${doc}.html`, title: `${title} | ${SITE.appName}`, description, body });
}

function homePage() {
  const body = `<h1>${escapeHtml(SITE.appName)}</h1>
<p class="lead">Save the Instagram reels you want to come back to, and find them later by typing what you remember.</p>
<ul>
<li>Share a reel to ${escapeHtml(SITE.appName)} from Instagram, or paste its link. Add a note on why you saved it if you like.</li>
<li>${escapeHtml(SITE.appName)} turns the reel into a card: a title, a summary, steps, places and tags.</li>
<li>Search your saves by a word, a place or what the reel was about. Group them into stacks.</li>
</ul>
<p>${escapeHtml(SITE.appName)} is an Android app on <a href="${SITE.playUrl}">Google Play</a>.</p>
<h2 id="pages">Policies</h2>
<ul class="links">
<li><a href="privacy.html">Privacy policy</a></li>
<li><a href="terms.html">Terms of service</a></li>
<li><a href="delete-account.html">Delete your account</a></li>
</ul>`;
  return page({
    file: "index.html",
    title: `${SITE.appName}: find the reels you saved`,
    description: `${SITE.appName} saves the Instagram reels you share to it and helps you find them later.`,
    body,
  });
}

function deletePage() {
  const app = escapeHtml(SITE.appName);
  const days = escapeHtml(SITE.deletionDays);
  const body = `<h1>Delete your ${app} account</h1>
<p class="lead">This page is for ${app}, the Android app listed on Google Play as &ldquo;${escapeHtml(SITE.listingTitle)}&rdquo;. You can delete your account and everything in it from the app, or by email without the app.</p>
<div class="note">
<p><strong>Subscribed to ${app} Pro?</strong> Deleting your account does not cancel a Google Play subscription, and neither does uninstalling the app. Cancel it first in <a href="https://play.google.com/store/account/subscriptions">Google Play subscriptions</a> (or Manage subscription in the app), signed in to the Google account you subscribed with.</p>
</div>
<h2 id="in-the-app">Delete it in the app</h2>
<ol>
<li>Open ${app} and tap your profile picture or initial at the top of the Home screen. This opens Account and settings.</li>
<li>Scroll to the bottom and tap <strong>Delete account</strong>.</li>
<li>Tap <strong>Continue</strong>, then <strong>Delete forever</strong>.</li>
</ol>
<p>Your account and its data are deleted right away, and you are signed out. Want a copy first? Download your archive (a JSON file of your saves, notes, cards and stacks) in Account and settings before you delete.</p>
<h2 id="by-email">Delete it without the app</h2>
<p>Email ${emailHtml()} from the address you sign in to ${app} with (for Google sign-in, your Google account's address), with the subject &ldquo;Delete my account&rdquo;. We only act on requests sent from the account's own address. We delete the account and its data within ${days} days and reply when it is done.</p>
<h2 id="what-is-deleted">What is deleted</h2>
<ul>
<li>Your account: your email address, and the name and profile photo Google shared if you signed in with Google.</li>
<li>Your saves (the reel links), your notes, and the search data made from them.</li>
<li>Your stacks, reading settings, monthly save count and plan details, including the subscription updates ${app} received from RevenueCat.</li>
<li>Your latest data archive and any work still queued for your saves.</li>
</ul>
<h2 id="what-is-kept">What is kept</h2>
<ul>
<li>Cards made from a reel's public content are shared by everyone who saved that reel and hold none of your data, so they stay.</li>
<li>Google keeps its own record of any Google Play purchase, under Google's privacy policy.</li>
<li>RevenueCat keeps its purchase record under your account ID (a random identifier, not your name or email) until we delete it. Ask for this in your email, or email us after deleting in the app, and we delete it too.</li>
<li>Copies may remain in our providers' backups for a limited period before they are overwritten.</li>
</ul>
<h2 id="some-data">Delete some data, keep the account</h2>
<ul>
<li><strong>One save:</strong> open its card, tap the &#8942; menu, then Delete. Its link, your note and your copy of the save are deleted.</li>
<li><strong>A note:</strong> open the card and edit the note, or clear it.</li>
<li><strong>A stack:</strong> open the stack and delete it. The saves in it stay in your library.</li>
</ul>
<p>The <a href="privacy.html">privacy policy</a> has the full list of what ${app} stores and <a href="privacy.html#how-long-data-is-kept">how long it is kept</a>.</p>`;
  return page({
    file: "delete-account.html",
    title: `Delete your account | ${SITE.appName}`,
    description: `How to delete your ${SITE.appName} account and its data, in the app or by email.`,
    body,
  });
}

function notFoundPage() {
  return page({
    file: "404.html",
    title: `Page not found | ${SITE.appName}`,
    description: "This page does not exist.",
    body: `<h1>Page not found</h1>\n<p>That page does not exist. Try the <a href="index.html">home page</a>.</p>`,
  });
}

// ----------------------------------------------------------------------- css --

const CSS = `/* Generated by frontend/scripts/build-public-site.js. Colours: the app's Daylight and Espresso tokens. */
:root {
  color-scheme: light dark;
  --canvas: #FFFFFF;
  --raised: #F4F2EE;
  --hairline: #E2DED6;
  --ink: #15130F;
  --ink-2: #5C554A;
  --accent: #E39A1E;
  --accent-text: #8F5700;
  --warm: #FCEFD9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #15120F;
    --raised: #29241E;
    --hairline: #3A332B;
    --ink: #F2ECE3;
    --ink-2: #B0A597;
    --accent: #E0961F;
    --accent-text: #F0AE4A;
    --warm: #3A2D1C;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow-wrap: break-word;
}
.wrap { max-width: 42rem; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 8px; background: var(--canvas); padding: 8px 12px; z-index: 1; }
header.site { border-bottom: 1px solid var(--hairline); }
header.site .wrap {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 8px 20px; padding-top: 14px; padding-bottom: 14px;
}
.brand {
  display: inline-flex; align-items: center; gap: 8px;
  color: var(--ink); font-weight: 700; font-size: 1.25rem; text-decoration: none;
}
.brand::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
header nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; }
header nav a { color: var(--ink-2); font-size: 0.9375rem; text-decoration: none; padding: 6px 0; display: inline-block; }
header nav a:hover { color: var(--ink); text-decoration: underline; }
header nav a[aria-current="page"] { color: var(--ink); font-weight: 600; }
main { padding-top: 32px; padding-bottom: 48px; }
h1 { font-size: clamp(1.75rem, 7vw, 2.25rem); line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 8px; }
h2 { font-size: 1.25rem; line-height: 1.3; margin: 40px 0 8px; scroll-margin-top: 16px; }
p, ul, ol { margin: 0 0 16px; }
ul, ol { padding-left: 1.25rem; }
li { margin: 0 0 8px; }
li::marker { color: var(--ink-2); }
a { color: var(--accent-text); text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
strong { font-weight: 650; }
.updated { color: var(--ink-2); font-size: 0.9375rem; }
.lead { font-size: 1.125rem; }
.note { background: var(--warm); border-radius: 12px; padding: 14px 16px 2px; margin: 0 0 24px; }
.toc { background: var(--raised); border-radius: 12px; padding: 14px 16px 6px; margin: 24px 0 8px; }
.toc p { margin: 0 0 8px; font-weight: 600; }
.toc ul { list-style: none; padding: 0; }
.toc li { margin: 0 0 6px; }
.links { list-style: none; padding: 0; }
.links a { display: inline-block; padding: 6px 0; font-weight: 600; }
footer.site { border-top: 1px solid var(--hairline); color: var(--ink-2); font-size: 0.9375rem; }
footer.site .wrap { padding-top: 24px; padding-bottom: 32px; }
footer.site p { margin: 0 0 8px; }
`;

// Hosts that read it (Netlify, Cloudflare Pages) add these headers; elsewhere it is ignored.
const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`;

// ---------------------------------------------------------------------- main --

function buildPublicSite({ strict = false } = {}) {
  const files = {
    "index.html": homePage(),
    "privacy.html": legalPage(
      "privacy",
      "Privacy Policy",
      `What ${SITE.appName} stores, who helps process it, and how to delete it.`,
      `<div class="note"><p>To delete your account and its data, in the app or without it, see <a href="delete-account.html">Delete your account</a>.</p></div>`,
    ),
    "terms.html": legalPage("terms", "Terms of Service", `The terms for using ${SITE.appName} and ${SITE.appName} Pro.`),
    "delete-account.html": deletePage(),
    "404.html": notFoundPage(),
    "style.css": CSS,
    _headers: HEADERS,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote public-site/ (${Object.keys(files).join(", ")})`);

  const left = Object.entries(SITE)
    .filter(([, v]) => isPlaceholder(v))
    .map(([k, v]) => `${k} ${v}`);
  if (left.length) {
    const msg = `public-site still has placeholders: ${left.join(", ")} (set LATELY_SUPPORT_EMAIL / LATELY_DELETION_DAYS)`;
    if (strict) throw new Error(msg);
    console.warn(`warning: ${msg}`);
  }
}

module.exports = { buildPublicSite, parseMarkdown, blocksToHtml };

if (require.main === module) {
  try {
    buildPublicSite({ strict: process.argv.includes("--strict") });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
