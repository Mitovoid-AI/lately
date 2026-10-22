// Screenshots of the Expo web demo in headless Chrome.
// usage: node shots.mjs <baseUrl> <outDir> <light|dark> <width> <height> <dpr> <name=path> [name=path ...]
// Signs in to demo mode by seeding AsyncStorage (localStorage) before the app loads.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [base, outDir, theme, w, h, dpr, ...shots] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.evaluateOnNewDocument((t) => {
    if (!t.endsWith("!")) localStorage.setItem("lately.demo-session", "1");
    localStorage.setItem("lately.theme", t.replace("!", ""));
    localStorage.setItem("lately.prefs", JSON.stringify({ theme: t.replace("!", "") }));
  }, process.env.NOSESSION ? theme + "!" : theme);
  for (const spec of shots) {
    const cut = spec.indexOf("=");
    const name = spec.slice(0, cut), route = spec.slice(cut + 1);
    await page.goto(base + route, { waitUntil: "networkidle2", timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 2500)); // entrance animations settle
    const file = path.join(outDir, `${name}-${theme}.png`);
    await page.screenshot({ path: file });
    console.log("saved", file);
  }
} finally {
  await browser.close();
}
