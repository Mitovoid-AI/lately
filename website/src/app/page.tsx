// Home: the user's saves, searchable. Server component — data never touches the
// client except as rendered HTML.
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listReels } from "@/lib/reels";
import { ReelCard } from "./reel-card";
import { AddForm } from "./add-form";
import { LogoutButton } from "./logout-button";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { q } = await searchParams;
  const reels = await listReels(user.id, q);

  return (
    <main className="wrap">
      <header className="top">
        <h1>Lately</h1>
        <span className="who">
          {user.username ? `@${user.username}` : (user.first_name ?? "you")}{" "}
          <LogoutButton />
        </span>
      </header>
      <p className="tagline">
        {reels.length} {reels.length === 1 ? "save" : "saves"}
        {q ? ` matching “${q}”` : ""}
      </p>

      <form className="search" action="/" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search what you remember…"
          aria-label="Search saves"
        />
        <button type="submit">Search</button>
      </form>

      <AddForm />

      {reels.length === 0 ? (
        <p className="empty">
          {q
            ? "Nothing matched. Try a different word."
            : "No saves yet. Send an Instagram link to your Telegram bot, or paste one above."}
        </p>
      ) : (
        reels.map((r) => <ReelCard key={r.id} reel={r} />)
      )}
    </main>
  );
}
