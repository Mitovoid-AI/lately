// Click through the main flows of the web demo and log what each tap did (antislop R-35 evidence).
// usage: node clickthrough.mjs <baseUrl>
import puppeteer from "puppeteer-core";

const base = process.argv[2];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => localStorage.setItem("lately.demo-session", "1"));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

/** Tap the first visible element whose accessible name or text matches. */
async function tap(label, match) {
  const ok = await page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const els = [...document.querySelectorAll('[role="button"],[role="link"],[role="tab"],[role="radio"],a,button,[aria-label]')];
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      const name = e.getAttribute("aria-label") || e.innerText || "";
      return r.width > 0 && r.height > 0 && re.test(name.trim());
    });
    if (!el) return false;
    el.click();
    return true;
  }, match);
  await wait(1500);
  const state = await page.evaluate(() => ({ path: location.pathname + location.search, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 110) }));
  log.push(`${ok ? "OK  " : "MISS"} ${label} -> ${state.path} | ${state.text}`);
}
async function go(path) {
  await page.goto(base + path, { waitUntil: "networkidle2", timeout: 120000 });
  await wait(2000);
  log.push(`GO   ${path}`);
}

await go("/");
await tap("Home search front door", "^Search your saves");
await tap("Example chip", "^reading room cafe$");
await tap("Best match result", "espresso bar with a 20-seat reading room");
await tap("Add to stack", "^Add to stack");
await tap("Close sheet", "^(Close|Cancel)$");
await tap("Back", "^(Back|Go back)$");
await tap("Stacks tab", "^Stacks");
await tap("Open a stack", "Food and coffee");
await tap("Back to stacks", "^(Back|Go back)$");
await tap("Save tab", "^Save$");
await tap("Close save sheet", "^(Close|Cancel|Not now)$");
await go("/");
await tap("Back for you: See all", "^See all");
await tap("Back", "^(Back|Go back)$");
await tap("Avatar to Account", "^(Account|Open account|Your account)");
await tap("Upgrade to Pro", "^Upgrade to Pro$");
await tap("Pick Monthly", "^Monthly");
await tap("Subscribe (demo)", "^Subscribe for");
await tap("Done", "^Done$");
await go("/reel/s-momo");
await tap("Directions", "^Directions");
await go("/reel/s-momo");
await tap("Tag link", "^Search your saves for");
console.log(log.join("\n"));
console.log("console/page errors:", errors.length ? errors.slice(0, 8).join("\n  ") : "none");
await browser.close();
