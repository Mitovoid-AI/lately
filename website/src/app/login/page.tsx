// Login page: paste the 6-digit code the bot DM'd you.
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  return (
    <main className="login">
      <h1>Lately</h1>
      <p className="tagline">
        Save it with a reason. Find it when you actually need it.
      </p>

      <ol>
        <li>
          Open your bot in Telegram and send <code>/login</code>
        </li>
        <li>It replies with a 6-digit code</li>
        <li>Paste the code below</li>
      </ol>

      <LoginForm />

      <p className="note">
        Codes expire in 10 minutes and work once. Sharing a reel to the bot also
        creates your account automatically.
      </p>
    </main>
  );
}
