// Renders the app icon, Android adaptive icon layers and splash image from the Lately logo
// (docs/design/stitch/logo-insta.svg — the gradient egg the app shows everywhere).
//
// sharp is not an app dependency; run it from a throwaway install:
//   npm install --prefix /tmp/sharp sharp@0.34.4
//   NODE_PATH=/tmp/sharp/node_modules node scripts/render-icons.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT = path.join(__dirname, "..", "assets", "brand");
fs.mkdirSync(OUT, { recursive: true });

const GRADIENT = `
  <linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#405de6"/><stop offset="15%" stop-color="#5851db"/>
    <stop offset="30%" stop-color="#833ab4"/><stop offset="50%" stop-color="#c13584"/>
    <stop offset="68%" stop-color="#e1306c"/><stop offset="78%" stop-color="#fd1d1d"/>
    <stop offset="88%" stop-color="#f56040"/><stop offset="94%" stop-color="#f77737"/>
    <stop offset="98%" stop-color="#fcaf45"/><stop offset="100%" stop-color="#ffdc80"/>
  </linearGradient>
  <radialGradient id="yolk" cx="38%" cy="32%" r="65%">
    <stop offset="0%" stop-color="#ffea79"/><stop offset="25%" stop-color="#ffb834"/>
    <stop offset="65%" stop-color="#f56040"/><stop offset="100%" stop-color="#c13584"/>
  </radialGradient>
  <filter id="eggShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.18"/>
  </filter>`;

const EGG_PATH = "M 256,86 C 334,86 384,186 384,274 C 384,350 326,404 256,404 C 186,404 128,350 128,274 C 128,186 178,86 256,86 Z";

/** The egg (white, yolk, glints) in the 512 box; `scale` shrinks it about the centre. */
const egg = (scale = 1) => `
  <g transform="translate(256 245) scale(${scale}) translate(-256 -245)">
    <g filter="url(#eggShadow)"><path d="${EGG_PATH}" fill="#FFFFFF"/></g>
    <circle cx="256" cy="286" r="68" fill="url(#yolk)"/>
    <ellipse cx="236" cy="260" rx="18" ry="12" transform="rotate(-30 236 260)" fill="#FFFFFF" opacity="0.92"/>
    <circle cx="274" cy="308" r="5" fill="#FFFFFF" opacity="0.55"/>
  </g>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>${GRADIENT}</defs>${body}</svg>`;

const files = {
  // Full-bleed square: stores and launchers apply their own mask.
  "icon.png": svg(`<rect width="512" height="512" fill="url(#ig)"/>${egg(1)}`),
  // Adaptive icon: the egg sits inside the 66% safe zone; the gradient is the background layer.
  "adaptive-foreground.png": svg(egg(0.72)),
  "adaptive-background.png": svg(`<rect width="512" height="512" fill="url(#ig)"/>`),
  // Android 13 themed icon: a single-colour egg with the yolk cut out.
  "adaptive-monochrome.png": svg(
    `<g transform="translate(256 245) scale(0.72) translate(-256 -245)"><path fill-rule="evenodd" fill="#000000" d="${EGG_PATH} M 324,286 a 68,68 0 1,0 -136,0 a 68,68 0 1,0 136,0 Z"/></g>`,
  ),
  // Splash: the rounded badge as the app shows it, on a transparent canvas.
  "splash-icon.png": svg(`<rect x="24" y="24" width="464" height="464" rx="112" fill="url(#ig)"/>${egg(1)}`),
};

(async () => {
  for (const [name, source] of Object.entries(files)) {
    await sharp(Buffer.from(source), { density: 1024 }).resize(1024, 1024).png().toFile(path.join(OUT, name));
    console.log("wrote", path.join("assets", "brand", name));
  }
  // Play Store listing icon: 512 × 512, no transparency.
  await sharp(Buffer.from(files["icon.png"]), { density: 512 }).resize(512, 512).flatten({ background: "#c13584" }).png().toFile(path.join(OUT, "play-store-icon.png"));
  console.log("wrote", path.join("assets", "brand", "play-store-icon.png"));
})();
