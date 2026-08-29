"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await fetch("/api/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      className="secondary"
      onClick={retry}
      disabled={busy}
      style={{ marginTop: 10 }}
    >
      {busy ? "Retrying…" : "Retry"}
    </button>
  );
}
