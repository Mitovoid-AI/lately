// Paste a link straight into the website — useful for testing the pipeline
// without going through Telegram.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { saveReel } from "@/lib/reels";
import { enrichReel } from "@/lib/enrich";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    reason?: string;
  };
  if (!body.url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const saved = await saveReel(user.id, body.url, "web", body.reason ?? null);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  // Await enrichment here so the tester sees the finished card on refresh.
  await enrichReel(saved.reel.id);
  return NextResponse.json({ ok: true, id: saved.reel.id });
}
