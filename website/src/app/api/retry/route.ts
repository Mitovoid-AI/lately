// Manual retry for a card whose enrichment failed. Scoped to the owner so a
// guessed reel id can't trigger work on someone else's data.
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getReel } from "@/lib/reels";
import { enrichReel } from "@/lib/enrich";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const owned = await getReel(user.id, body.id);
  if (!owned) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const result = await enrichReel(body.id);
  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
  );
}
