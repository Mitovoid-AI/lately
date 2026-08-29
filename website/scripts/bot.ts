// Telegram bot worker — long polling, no webhook, no public URL.
//
// Run with:  npm run bot
//
// Long polling is the right choice for local testing: a webhook would need a
// public HTTPS endpoint (ngrok/tunnel), whereas getUpdates works from a laptop
// behind NAT. Switch to webhooks only when deploying.
//
// What it does:
//   /start, /help  → explain itself
//   /login         → issue a 6-digit code for the website
//   any IG link    → save it for THAT user, enrich, reply with the card
//
// Each Telegram account maps to its own row in `users`, so saves are per-user
// from the first message — no shared inbox.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load website/.env.local before importing anything that reads env at call time.
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { TELEGRAM_BOT_TOKEN } = await import("../src/lib/config.ts");
const { upsertTelegramUser, saveReel } = await import("../src/lib/reels.ts");
const { issueLoginCode } = await import("../src/lib/auth.ts");
const { enrichReel } = await import("../src/lib/enrich.ts");
const { looksLikeInstagram } = await import("../src/lib/instagram.ts");

const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN()}`;

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number };
  text?: string;
};
type TgUpdate = { update_id: number; message?: TgMessage };

async function call<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result as T;
}

async function send(chatId: number, text: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

const HELP = `<b>Lately</b> — save it with a reason, find it when you need it.

Send me any Instagram reel link and I'll pull out the caption, transcribe it, figure out the category, and tag it so you can search it later.

/login — get a code to sign into the website
/help — this message`;

// Renders the finished card as a Telegram message.
function formatCard(reel: {
  title: string | null;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  steps: string[] | null;
  source_url: string;
  status: string;
  failure_reason: string | null;
}): string {
  if (reel.status !== "enriched") {
    return `Saved, but I couldn't process it fully.\n\n${
      reel.failure_reason ?? ""
    }\n\nIt's still in your list — you can retry from the website.`;
  }
  const lines: string[] = [];
  if (reel.category) lines.push(`<b>${escapeHtml(reel.category)}</b>`);
  if (reel.title) lines.push(escapeHtml(reel.title));
  if (reel.summary) lines.push("", escapeHtml(reel.summary));
  if (reel.steps?.length) {
    lines.push("");
    reel.steps.forEach((s, i) => lines.push(`${i + 1}. ${escapeHtml(s)}`));
  }
  if (reel.tags?.length) {
    lines.push("", reel.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" "));
  }
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleMessage(msg: TgMessage): Promise<void> {
  if (!msg.from || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Every message identifies the user, so saves are scoped from the start.
  const user = await upsertTelegramUser({
    id: msg.from.id,
    username: msg.from.username,
    first_name: msg.from.first_name,
    last_name: msg.from.last_name,
  });

  if (text === "/start" || text === "/help") {
    await send(chatId, HELP);
    return;
  }

  if (text === "/login") {
    const code = await issueLoginCode(user.id);
    await send(
      chatId,
      `Your login code is <b>${code}</b>\n\nPaste it at http://localhost:3000/login — valid for 10 minutes, single use.`,
    );
    return;
  }

  if (!looksLikeInstagram(text)) {
    await send(chatId, "Send me an Instagram reel link, or /help.");
    return;
  }

  const saved = await saveReel(user.id, text, "telegram");
  if (!saved.ok) {
    await send(chatId, `Couldn't save that: ${saved.error}`);
    return;
  }

  await send(chatId, "Saved. Working on it…");

  const result = await enrichReel(saved.reel.id);
  if (result.ok) {
    await send(chatId, formatCard(result.reel));
  } else {
    await send(
      chatId,
      `Saved, but processing failed:\n${result.error}\n\nIt's in your list — retry from the website.`,
    );
  }
}

// --- Long polling loop -------------------------------------------------------
let offset = 0;
let running = true;

process.on("SIGINT", () => {
  console.log("\nStopping bot…");
  running = false;
});

const me = await call<{ username: string }>("getMe", {});
console.log(`Bot running as @${me.username}. Ctrl+C to stop.`);

while (running) {
  try {
    const updates = await call<TgUpdate[]>("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) {
        try {
          await handleMessage(u.message);
        } catch (e) {
          // One bad message must not kill the worker.
          console.error("handler error:", e instanceof Error ? e.message : e);
        }
      }
    }
  } catch (e) {
    console.error("poll error:", e instanceof Error ? e.message : e);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
