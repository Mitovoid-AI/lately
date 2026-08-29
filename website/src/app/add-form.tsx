"use client";

// Paste a reel link directly — the local testing path that skips Telegram.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      setUrl("");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Save failed.");
    }
    setBusy(false);
  }

  return (
    <>
      <form className="search" onSubmit={submit}>
        <input
          type="url"
          placeholder="Paste an Instagram reel link to test…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Reel URL"
          required
        />
        <button type="submit" disabled={busy || !url}>
          {busy ? "Processing…" : "Save"}
        </button>
      </form>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
