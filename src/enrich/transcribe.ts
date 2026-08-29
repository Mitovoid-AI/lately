// Groq Whisper transcription — turns the reel's audio into text (the "SRT").
// Groq exposes an OpenAI-compatible /audio/transcriptions endpoint.
// Free tier: ~25MB file cap, which comfortably fits 1–5MB reel audio.
import {
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_TRANSCRIBE_MODEL,
} from "../config";

// A local file URI (from on-device fetch) plus its mime type.
export type AudioInput = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

// Sends audio to Groq Whisper and returns plain transcript text.
// Uses multipart/form-data; React Native's fetch accepts a {uri,name,type} part.
export async function transcribeAudio(input: AudioInput): Promise<string> {
  const form = new FormData();
  form.append("file", {
    // RN FormData file shape — not the web File object.
    uri: input.uri,
    name: input.fileName ?? "audio.m4a",
    type: input.mimeType ?? "audio/m4a",
  } as unknown as Blob);
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("response_format", "text");

  const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      // NOTE: do NOT set Content-Type — fetch sets the multipart boundary itself.
    },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Groq transcribe ${res.status}: ${await res.text()}`);
  }
  // response_format=text returns the transcript as plain text.
  return (await res.text()).trim();
}
