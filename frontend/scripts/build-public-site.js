// Builds the public web pages Google Play needs (privacy policy, terms, account deletion) from the
// same legal/*.md the app bundles, plus the product landing page with the test-APK download, into
// ../docs/site/. Plain HTML + CSS: no scripts, no trackers, no third-party requests (the landing
// page's fonts and images are self-hosted in docs/site/assets/). GitHub Pages serves the folder
// (.github/workflows/pages.yml); it can also be uploaded as-is to any static host
// (docs/play-store/hosting.md).
//
//   node scripts/build-public-site.js            build (scripts/build-legal.js also runs this)
//   node scripts/build-public-site.js --strict   build, then fail if a [PLACEHOLDER] is left
//
// Before publishing, set the two values below (or pass them as environment variables):
//   LATELY_SUPPORT_EMAIL   the support email on the Play listing
//   LATELY_DELETION_DAYS   how many days an emailed deletion request may take (a number)
// The Pages workflow also passes the latest GitHub release, so the button names its build:
//   LATELY_RELEASE_TAG (apk-12), LATELY_RELEASE_DATE (ISO time), LATELY_RELEASE_BYTES
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const OUT = path.join(root, "..", "docs", "site");

const SITE = {
  appName: "Lately",
  // Must match the app name on the Play listing (docs/play-store/listing.md).
  listingTitle: "Lately: Find Saved Reels",
  playUrl: "https://play.google.com/store/apps/details?id=app.lately.android",
  supportEmail: process.env.LATELY_SUPPORT_EMAIL || "[SUPPORT EMAIL]",
  deletionDays: process.env.LATELY_DELETION_DAYS || "[DAYS]",
};

const REPO = "Mitovoid-AI/lately";
const RELEASE = {
  tag: process.env.LATELY_RELEASE_TAG || "",
  date: process.env.LATELY_RELEASE_DATE || "",
  bytes: Number(process.env.LATELY_RELEASE_BYTES) || 0,
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

/** The test-APK link and its one-line description: the release the workflow passed in, else
 * GitHub's always-latest link. */
function download() {
  const href = RELEASE.tag
    ? `https://github.com/${REPO}/releases/download/${encodeURIComponent(RELEASE.tag)}/lately.apk`
    : `https://github.com/${REPO}/releases/latest/download/lately.apk`;
  const build = /^apk-\d+$/.test(RELEASE.tag) ? `Test build ${RELEASE.tag.slice(4)}` : `Test build ${RELEASE.tag}`.trim();
  const day = RELEASE.date
    ? new Date(RELEASE.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "";
  const size = RELEASE.bytes ? `${Math.round(RELEASE.bytes / 1e6)} MB` : "";
  return { href: escapeHtml(href), facts: escapeHtml([build, day, size].filter(Boolean).join(" · ")) };
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

// Sample saves for the card rail: the demo account's own saves and photos (frontend/assets/stitch,
// resized into docs/site/assets/saves). The middle one sits behind the phone on wide screens.
const RAIL = [
  { img: "rainier", title: "Mount Rainier in 3 days on $400", meta: "@sample.trails", tag: "Food & Places", tint: "food" },
  { img: "github", title: "5 GitHub search tricks to find great repos", meta: "@sample.dev", tag: "Dev & Tools", tint: "dev" },
  { img: "kyoto-cafe", title: "Kyoto-style pour-over bar hidden in Southeast Portland", meta: "@sample.coffee", tag: "Food & Places", tint: "food" },
  { img: "espresso-bar", title: "The espresso bar with a 20-seat reading room", meta: "@sample.cafe", tag: "Food & Places", tint: "food" },
  { img: "momos", title: "Hole-in-the-wall momo spot in Jackson Heights", meta: "Momo Point · $15 for two", tag: "Food & Places", tint: "food" },
  { img: "stretch", title: "10-minute desk stretch flow", meta: "@sample.mobility", tag: "Fitness", tint: "fit" },
  { img: "boots", title: "Hiking boots under $150 that actually grip", meta: "@sample.trails", tag: "Fitness", tint: "fit" },
];

/** A phone frame around a real app screenshot (docs/site/assets/shots, from the store capture). */
function phone(cls, shot, alt, darkShot) {
  const dark = darkShot ? `<source srcset="assets/shots/${darkShot}.webp" media="(prefers-color-scheme: dark)">` : "";
  return `<figure class="phone ${cls}"><picture>${dark}<img src="assets/shots/${shot}.webp" alt="${escapeHtml(alt)}" width="720" height="1559"></picture></figure>`;
}

/** The product landing page. It has its own header and stylesheet (landing.css); the policy pages
 * keep the plain layout from page(). */
function landingPage() {
  const app = escapeHtml(SITE.appName);
  const dl = download();
  const rail = RAIL.map(
    (s) => `<li class="save save-${s.tint}"><img src="assets/saves/${s.img}.webp" alt="" width="560" height="420" loading="lazy"><div><p class="save-title">${escapeHtml(s.title)}</p><p class="save-meta">${escapeHtml(s.meta)}</p><span class="tag">${escapeHtml(s.tag)}</span></div></li>`,
  ).join("\n");
  const email = isPlaceholder(SITE.supportEmail) ? "" : `<p>Questions: ${emailHtml()}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${app}: save Instagram reels, find them later</title>
<meta name="description" content="${app} turns the Instagram reels you save into cards with the places, prices and steps, so you can find them later by typing what you remember.">
<link rel="icon" href="assets/icon.png">
<link rel="preload" href="assets/fonts/bricolage-800.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="landing.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top wrap">
<a class="logo" href="index.html"><img src="assets/icon.png" alt="" width="32" height="32">${app}</a>
<nav aria-label="Sections"><a href="#how">How it works</a><a href="#cards">Cards</a><a href="#search">Search</a></nav>
<a class="pill pill-outline" href="${dl.href}">Download App</a>
</header>
<main id="main">
<section class="hero wrap">
<h1 class="display"><span class="bold">Save the reel</span><span class="thin">Find it later</span></h1>
<div class="hero-panel">
<svg class="loop" viewBox="0 0 1200 400" preserveAspectRatio="xMinYMax slice" aria-hidden="true"><path d="M-40 330C120 360 260 300 380 250 500 200 610 175 640 230 670 290 600 330 560 290 520 250 590 170 700 170 860 170 960 320 1240 300"/></svg>
<p class="hero-copy">Share an Instagram reel to ${app} and it writes the reel down for you: what it was, the places, the prices, the steps. Weeks later, type what you remember and it comes back.</p>
<a class="pill pill-solid" href="${dl.href}">Download for Android</a>
<p class="meta">${dl.facts}. Android app, installed from this page.</p>
</div>
${phone("hero-phone", "home-light", "Lately's Home screen: a search bar, saved reels to revisit, and a grid of recently saved reels.", "home-dark")}
</section>
<section class="how wrap" id="how">
${phone("how-phone", "pending-light", "A new save in progress: got the reel, listening to it, finding places and steps, card ready.")}
<div>
<h2 class="display"><span class="bold">Share it.</span><span class="thin">${app} does the rest</span></h2>
<p class="lede">In Instagram, tap Share and pick ${app}, or paste the reel's link. You don't have to wait: the card is written while you keep scrolling.</p>
<ol class="steps">
<li><strong>Got the reel</strong><span>The link and the caption arrive.</span></li>
<li><strong>Listening to it</strong><span>What is said in the reel is turned into text.</span></li>
<li><strong>Finding places and steps</strong><span>Names, addresses, prices and how-tos are picked out.</span></li>
<li><strong>Card ready</strong><span>A title, a short summary and tags, ready to search.</span></li>
</ol>
</div>
</section>
<section class="cards" id="cards">
<div class="cards-top wrap">
<div>
<h2 class="display"><span class="bold">Every reel</span><span class="bold">becomes a card</span></h2>
<p class="lede">A title and a short summary, the places with directions, prices, steps and tags. Add your own note on why you saved it.</p>
<a class="pill pill-solid" href="${dl.href}">Download App</a>
</div>
${phone("cards-phone", "card-light", "A saved reel's card with the place, price, a short summary and a Directions button.")}
<div class="find" id="search">
<p class="find-line">Find it by what you remember</p>
<p>Search reads the whole card and your notes, not only the title. Type it the way you'd say it:</p>
<ul class="queries"><li>reading room cafe</li><li>momo place cash only</li><li>rainier on a budget</li></ul>
</div>
</div>
<ul class="rail" aria-label="Sample saves">
${rail}
</ul>
<p class="rail-note wrap">Sample saves from ${app}'s demo account.</p>
</section>
<section class="final wrap">
<div class="final-panel">
<h2 class="display"><span class="bold">Stop losing</span><span class="thin">good reels</span></h2>
<a class="pill pill-solid" href="${dl.href}">Download for Android</a>
<p class="meta">${dl.facts}</p>
</div>
</section>
</main>
<footer class="bottom wrap">
<a class="logo" href="index.html"><img src="assets/icon.png" alt="" width="32" height="32">${app}</a>
<nav aria-label="Policies"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="delete-account.html">Delete account</a></nav>
<div>${email}<p>${app} is not affiliated with Instagram or Meta.</p></div>
</footer>
</body>
</html>
`;
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

// The landing page's look follows a reference the founder chose: huge two-line headlines (bold, then
// light italic), a warm rounded panel with a drawn loop, real screenshots in phone frames, dark pill
// buttons. Colours are the app's Daylight and Espresso tokens; fonts are the app's own.
const LANDING_CSS = `/* Generated by frontend/scripts/build-public-site.js. Fonts: Bricolage Grotesque and Inter (SIL OFL, assets/fonts). */
@font-face { font-family: "Bricolage Grotesque"; font-weight: 800; font-display: swap; src: url(assets/fonts/bricolage-800.woff) format("woff"); }
@font-face { font-family: "Inter"; font-weight: 300; font-style: italic; font-display: swap; src: url(assets/fonts/inter-300-italic.woff) format("woff"); }
@font-face { font-family: "Inter"; font-weight: 400; font-display: swap; src: url(assets/fonts/inter-400.woff) format("woff"); }
@font-face { font-family: "Inter"; font-weight: 600; font-display: swap; src: url(assets/fonts/inter-600.woff) format("woff"); }
:root {
  color-scheme: light dark;
  --page: #F6F4F0;
  --panel: #FCEFD9;
  --loop: #F3DBB2;
  --ink: #15130F;
  --ink-2: #5C554A;
  --hairline: #E2DED6;
  --surface: #FFFFFF;
  --pill: #15130F;
  --on-pill: #FFFFFF;
  --bezel: #15130F;
  --ring: transparent;
  --tint-food: #FCEFD9;
  --tint-dev: #E4ECF8;
  --tint-fit: #E3F0E4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #15120F;
    --panel: #2A2219;
    --loop: #3B2E1F;
    --ink: #F2ECE3;
    --ink-2: #B0A597;
    --hairline: #3A332B;
    --surface: #1E1A16;
    --pill: #F2ECE3;
    --on-pill: #15130F;
    --bezel: #050403;
    --ring: #3A332B;
    --tint-food: #3A2D1C;
    --tint-dev: #1F2938;
    --tint-fit: #1E2C21;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--page); color: var(--ink); overflow-x: hidden;
  font: 400 17px/1.55 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
img { display: block; max-width: 100%; height: auto; }
a { color: inherit; }
a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 6px; }
p { margin: 0 0 16px; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 8px; background: var(--page); padding: 8px 12px; z-index: 10; }
.wrap { max-width: 1200px; margin-left: auto; margin-right: auto; padding-left: 24px; padding-right: 24px; }

.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 18px; padding-bottom: 18px; }
.logo {
  display: inline-flex; align-items: center; gap: 10px; text-decoration: none;
  font: 800 1.375rem/1 "Bricolage Grotesque", system-ui, sans-serif; letter-spacing: -0.01em;
}
.logo img { width: 32px; height: 32px; border-radius: 8px; }
.top nav { display: flex; gap: 40px; }
.top nav a, .bottom nav a { text-decoration: none; font-size: 0.9375rem; padding: 8px 0; }
.top nav a:hover, .bottom nav a:hover { text-decoration: underline; text-underline-offset: 4px; }

.pill {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 12px 28px;
  border-radius: 999px; font-weight: 600; font-size: 1rem; text-decoration: none; white-space: nowrap;
}
.pill:hover { text-decoration: underline; text-underline-offset: 4px; }
.pill-solid { background: var(--pill); color: var(--on-pill); }
.pill-outline { border: 1.5px solid var(--ink); }

.display { margin: 0; font-weight: 400; line-height: 0.95; text-transform: uppercase; }
.display .bold { display: block; font-family: "Bricolage Grotesque", system-ui, sans-serif; font-weight: 800; letter-spacing: -0.025em; }
.display .thin { display: block; font-family: Inter, system-ui, sans-serif; font-weight: 300; font-style: italic; letter-spacing: -0.035em; }
.lede { font-size: 1.125rem; max-width: 34rem; margin: 24px 0 32px; }
.meta { color: var(--ink-2); font-size: 0.875rem; margin: 16px 0 0; }

.phone {
  margin: 0; position: relative; padding: 9px; border-radius: 46px; background: var(--bezel);
  box-shadow: 0 0 0 1px var(--ring), 0 40px 60px -36px rgba(21, 19, 15, 0.55);
}
.phone::before {
  content: ""; position: absolute; top: 21px; left: 50%; width: 11px; height: 11px; margin-left: -5.5px;
  border-radius: 50%; background: #000; z-index: 1;
}
.phone img { width: 100%; border-radius: 37px; }

.hero {
  display: grid; grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: auto auto;
  column-gap: 48px; padding-top: 28px; padding-bottom: 24px;
}
.hero h1 { grid-column: 1; grid-row: 1; font-size: clamp(2.4rem, 7.4vw, 6.6rem); padding-bottom: 44px; }
.hero-panel {
  grid-column: 1 / -1; grid-row: 2; position: relative; overflow: hidden;
  background: var(--panel); border-radius: 32px; padding: 52px 420px 52px 52px;
}
.hero-panel > :not(.loop) { position: relative; }
.loop { position: absolute; left: 0; bottom: 0; width: 100%; height: 100%; fill: none; stroke: var(--loop); stroke-width: 26; stroke-linecap: round; }
.hero-copy { font-size: 1.25rem; line-height: 1.5; max-width: 30rem; margin-bottom: 32px; }
.hero-phone { grid-column: 2; grid-row: 1 / 3; align-self: end; z-index: 1; margin: 0 28px -28px 0; }

.how { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 96px; align-items: center; padding-top: 140px; padding-bottom: 120px; }
.how h2 { font-size: clamp(2.2rem, 4.8vw, 4rem); }
.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; max-width: 36rem; }
.steps li { counter-increment: step; display: grid; grid-template-columns: 56px 1fr; padding: 18px 0; border-top: 1px solid var(--hairline); }
.steps li::before { content: counter(step, decimal-leading-zero); grid-row: 1 / 3; font: 800 1.125rem/1.5 "Bricolage Grotesque", system-ui, sans-serif; }
.steps strong { font-weight: 600; }
.steps span { color: var(--ink-2); }

.cards { padding-top: 40px; padding-bottom: 112px; }
.cards-top { display: grid; grid-template-columns: minmax(0, 1fr) 290px minmax(0, 1fr); gap: 56px; align-items: start; }
.cards h2 { font-size: clamp(2.3rem, 4.6vw, 4rem); }
.cards-phone { position: relative; z-index: 2; margin-bottom: -300px; }
.find { padding-top: 12px; }
.find-line {
  font: italic 300 clamp(1.9rem, 3.4vw, 2.9rem)/1.02 Inter, system-ui, sans-serif;
  text-transform: uppercase; letter-spacing: -0.035em; margin-bottom: 20px;
}
.queries { list-style: none; margin: 20px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.queries li { border: 1px solid var(--hairline); background: var(--surface); border-radius: 999px; padding: 7px 16px; font-size: 0.9375rem; }
.queries li::before { content: "\\201C"; } .queries li::after { content: "\\201D"; }
.rail { list-style: none; margin: 72px 0 0; padding: 0; display: flex; justify-content: center; gap: 20px; overflow: hidden; }
.save { flex: 0 0 252px; border-radius: 20px; overflow: hidden; background: var(--tint); }
.save img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.save div { padding: 14px 16px 18px; }
.save-title { font-weight: 600; line-height: 1.3; margin-bottom: 6px; }
.save-meta { color: var(--ink-2); font-size: 0.8125rem; margin-bottom: 12px; }
.tag { display: inline-block; background: var(--surface); border-radius: 999px; padding: 4px 11px; font-size: 0.75rem; font-weight: 600; }
.save-food { --tint: var(--tint-food); }
.save-dev { --tint: var(--tint-dev); }
.save-fit { --tint: var(--tint-fit); }
.rail-note { text-align: center; color: var(--ink-2); font-size: 0.8125rem; margin-top: 16px; }
/* On wide screens the phone stands where the middle card would be. */
@media (min-width: 961px) { .rail > :nth-child(4) { visibility: hidden; } }

.final-panel { background: var(--panel); border-radius: 32px; padding: 88px 24px; text-align: center; }
.final h2 { font-size: clamp(2.4rem, 7.6vw, 6rem); margin-bottom: 40px; }
.bottom {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 40px;
  padding-top: 48px; padding-bottom: 48px; color: var(--ink-2); font-size: 0.9375rem;
}
.bottom .logo { color: var(--ink); }
.bottom nav { display: flex; flex-wrap: wrap; gap: 4px 28px; }
.bottom p { margin: 0; }

@media (max-width: 960px) {
  .top nav { display: none; }
  .hero { grid-template-columns: minmax(0, 1fr); }
  .hero h1 { padding-bottom: 28px; }
  .hero-panel { grid-column: 1; padding: 36px 28px 220px; }
  .hero-phone { grid-column: 1; grid-row: 3; justify-self: center; width: min(300px, 78vw); margin: -190px 0 0; }
  .how { grid-template-columns: minmax(0, 1fr); gap: 48px; padding-top: 96px; padding-bottom: 88px; }
  .how-phone { order: 2; justify-self: center; width: min(280px, 72vw); }
  .cards-top { grid-template-columns: minmax(0, 1fr); gap: 48px; }
  .cards-phone { justify-self: center; width: min(280px, 72vw); margin-bottom: 0; }
  .rail { justify-content: flex-start; overflow-x: auto; scroll-snap-type: x mandatory; padding: 0 24px 8px; margin-top: 48px; }
  .save { flex-basis: 236px; scroll-snap-align: center; }
  .final-panel { padding: 64px 20px; }
}
@media (max-width: 480px) {
  .wrap { padding-left: 16px; padding-right: 16px; }
  .top .pill { min-height: 44px; padding: 10px 18px; }
  .hero-panel { border-radius: 24px; padding: 28px 20px 200px; }
  .hero-copy { font-size: 1.125rem; }
  .rail { padding-left: 16px; padding-right: 16px; }
}
`;

// Hosts that read it (Netlify, Cloudflare Pages) add these headers; elsewhere it is ignored.
const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`;

// ---------------------------------------------------------------------- main --

function buildPublicSite({ strict = false } = {}) {
  const files = {
    "index.html": landingPage(),
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
    "landing.css": LANDING_CSS,
    _headers: HEADERS,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote docs/site/ (${Object.keys(files).join(", ")})`);

  const left = Object.entries(SITE)
    .filter(([, v]) => isPlaceholder(v))
    .map(([k, v]) => `${k} ${v}`);
  if (left.length) {
    const msg = `docs/site still has placeholders: ${left.join(", ")} (set LATELY_SUPPORT_EMAIL / LATELY_DELETION_DAYS)`;
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
