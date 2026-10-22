// Play Store assets from raw app screenshots: 1080x1920 framed phone screenshots with a caption,
// and the 1024x500 feature graphic. Fonts are the app's own (Bricolage Grotesque, Inter).
// usage: node compose.mjs <config.json>
//   config: { fontsDir, outDir, frames: [{ raw, caption, out }], feature: { tiles: [png...], out } }
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.mkdirSync(cfg.outDir, { recursive: true });
const font = (rel) => pathToFileURL(path.join(cfg.fontsDir, rel)).href;
const fontFaces = `
  @font-face { font-family: Display; src: url("${font("bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf")}"); }
  @font-face { font-family: DisplayBold; src: url("${font("bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf")}"); }
  @font-face { font-family: Body; src: url("${font("inter/500Medium/Inter_500Medium.ttf")}"); }
`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Warm marigold tint behind the phone: the app's `warm` token, so the set reads as Lately.
const frameHtml = (raw, caption) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces}
  html, body { margin: 0; width: 1080px; height: 1920px; background: #FCEFD9; overflow: hidden; }
  body { display: flex; flex-direction: column; align-items: center; padding-top: 110px; box-sizing: border-box; }
  .cap { width: 900px; font: 70px/1.12 Display, sans-serif; letter-spacing: -1.5px; color: #15130F; }
  .phone { margin-top: 56px; width: 760px; flex-shrink: 0;
           border-radius: 64px; border: 14px solid #15130F; background: #15130F; overflow: hidden;
           box-shadow: 0 30px 80px rgba(21,19,15,0.25); }
  .phone img { display: block; width: 100%; border-radius: 50px; }
</style></head><body>
  <div class="cap">${esc(caption)}</div>
  <div class="phone"><img src="${pathToFileURL(raw).href}"></div>
</body></html>`;

const featureHtml = (tiles) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces}
  html, body { margin: 0; width: 1024px; height: 500px; background: #FFFFFF; overflow: hidden; }
  .word { position: absolute; left: 64px; top: 120px; font: 120px/1 Display, sans-serif; letter-spacing: -4px; color: #15130F; }
  .dot { color: #E39A1E; }
  .tag { position: absolute; left: 68px; top: 270px; width: 430px; font: 34px/1.25 DisplayBold, sans-serif; letter-spacing: -0.5px; color: #5C554A; }
  .tiles { position: absolute; right: 48px; top: 40px; display: flex; gap: 18px; transform: rotate(-4deg); }
  .tiles img { width: 150px; height: 200px; object-fit: cover; border-radius: 16px; box-shadow: 0 12px 30px rgba(21,19,15,0.18); }
  .tiles img:nth-child(2) { margin-top: 60px; } .tiles img:nth-child(3) { margin-top: 20px; }
</style></head><body>
  <div class="word">Lately<span class="dot">.</span></div>
  <div class="tag">Save reels from Instagram. Find them by what you remember.</div>
  <div class="tiles">${tiles.map((t) => `<img src="${pathToFileURL(t).href}">`).join("")}</div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-first-run", "--disable-extensions", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  const render = async (html, w, h, out) => {
    const tmp = path.join(cfg.outDir, `_tmp.html`);
    fs.writeFileSync(tmp, html);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(cfg.outDir, out) });
    fs.unlinkSync(tmp);
    console.log("wrote", out);
  };
  for (const f of cfg.frames ?? []) await render(frameHtml(f.raw, f.caption), 1080, 1920, f.out);
  if (cfg.feature) await render(featureHtml(cfg.feature.tiles), 1024, 500, cfg.feature.out);
} finally {
  await browser.close();
}
