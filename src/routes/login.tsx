import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { Button } from "@/components/toduck/ui";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!authEnabled) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
        <h1 className="font-display text-3xl text-ink">Toduck</h1>
        <p className="mt-2 text-sm text-muted">Auth is off. Set VITE_AUTH_ENABLED=true to require sign-in.</p>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "up"
          ? await authClient.signUp.email({ email, password, name: email.split("@")[0] || "user" })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Could not sign in.");
        return;
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-3xl text-ink">Toduck</h1>
      <p className="mt-1 text-sm text-muted">{mode === "up" ? "Create an account" : "Sign in"}</p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="field"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="field"
          type="password"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "…" : mode === "up" ? "Create account" : "Sign in"}
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 text-sm text-muted underline-offset-2 hover:underline"
        onClick={() => setMode((m) => (m === "in" ? "up" : "in"))}
      >
        {mode === "up" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </div>
  );
}
