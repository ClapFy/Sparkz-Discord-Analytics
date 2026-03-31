"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      if (!res.ok) {
        setError("Invalid credentials");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1fr",
        alignItems: "center",
        justifyItems: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }} className="panel">
        <p className="sys-label" style={{ marginBottom: 16 }}>
          Access // Admin
        </p>
        <form onSubmit={onSubmit}>
          <label className="sys-label" htmlFor="u">
            Username
          </label>
          <input
            id="u"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ marginTop: 6, marginBottom: 14 }}
          />
          <label className="sys-label" htmlFor="p">
            Password
          </label>
          <input
            id="p"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginTop: 6, marginBottom: 16 }}
          />
          {error ? (
            <p style={{ color: "#c66", marginBottom: 12, fontSize: "0.95rem" }}>{error}</p>
          ) : null}
          <button type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
