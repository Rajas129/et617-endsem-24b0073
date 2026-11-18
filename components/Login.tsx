"use client";

import { useState } from "react";

export default function Login({ onSignedIn }: { onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { username?: string; error?: string };
      if (!res.ok || !data.username) { setError(data.error ?? "Could not sign you in."); return; }
      onSignedIn(data.username);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h1>Sign in</h1>
      <p className="muted">
        Your work is saved under your name, so you can stop whenever you like and
        pick it up again.
      </p>

      <form onSubmit={submit}>
        <label htmlFor="u" style={{ fontWeight: 600, fontSize: "0.92rem" }}>Username</label>
        <input id="u" type="text" value={username} autoComplete="username"
               autoCapitalize="none" spellCheck={false}
               onChange={(e) => setUsername(e.target.value)} />

        <label htmlFor="p" style={{ fontWeight: 600, fontSize: "0.92rem", marginTop: 10, display: "block" }}>
          Password
        </label>
        <input id="p" type="password" value={password} autoComplete="current-password"
               onChange={(e) => setPassword(e.target.value)} />

        {error && <p className="banner offline" style={{ marginTop: 12 }}>{error}</p>}

        <button className="primary" type="submit" disabled={busy || !username || !password}
                style={{ marginTop: 14 }}>
          {busy ? "Signing you in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
