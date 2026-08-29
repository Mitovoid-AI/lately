// Groq Whisper transcription (server side). Downloads the reel's media, then
// uploads it to Groq's OpenAI-compatible /audio/transcriptions endpoint.
//
// Free tier caps files at ~25MB; reel media is typically 1–5MB. We bail out
// rather than upload something oversized.
import {
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_TRANSCRIBE_MODEL,
} from "./config";

const MAX_BYTES = 24 * 1024 * 1024;

export async function transcribeFromUrl(mediaUrl: string): Promise<string> {
  const media = await fetch(mediaUrl);
  if (!media.ok) throw new Error(`media download ${media.status}`);

  const buf = await media.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      `media too large for free tier: ${Math.round(buf.byteLength / 1e6)}MB`,
    );
  }

  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/mp4" }), "reel.mp4");
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("response_format", "text");

  const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    // No Content-Type header — fetch sets the multipart boundary itself.
    headers: { Authorization: `Bearer ${GROQ_API_KEY()}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcribe ${res.status}: ${await res.text()}`);
  }
  return (await res.text()).trim();
}
