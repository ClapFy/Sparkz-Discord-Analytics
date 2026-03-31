"use client";

import { useCallback, useState } from "react";

export default function InternalDiagPage() {
  const [token, setToken] = useState("");
  const [out, setOut] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setOut("");
    try {
      const r = await fetch("/api/internal/diagnostics", {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      });
      const text = await r.text();
      try {
        const j = JSON.parse(text) as unknown;
        setOut(JSON.stringify(j, null, 2));
      } catch {
        setOut(text || String(r.status));
      }
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: 24 }}>
      <p className="sys-label" style={{ marginBottom: 8 }}>
        Internal diagnostics
      </p>
      <h1 style={{ fontWeight: 400, fontSize: "1.4rem", marginTop: 0 }}>Bearer token console</h1>
      <p style={{ color: "var(--muted)", fontSize: "0.95rem", lineHeight: 1.5 }}>
        Set <code style={{ color: "var(--fg)" }}>INTERNAL_DIAG_TOKEN</code> in your web service secrets (deployed via
        GitHub). Paste the same value here to call the read-only diagnostics API. Nothing is sent to our servers except
        your own app origin.
      </p>
      <label className="sys-label" style={{ display: "block", marginTop: 20 }}>
        Token
      </label>
      <input
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="INTERNAL_DIAG_TOKEN"
        style={{ marginTop: 6, marginBottom: 12 }}
      />
      <button type="button" disabled={loading || !token.trim()} onClick={() => void run()}>
        {loading ? "Running…" : "Run diagnostics"}
      </button>
      {out ? (
        <pre
          style={{
            marginTop: 20,
            padding: 12,
            background: "#0a0a0a",
            border: "1px solid var(--line)",
            overflow: "auto",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {out}
        </pre>
      ) : null}
    </main>
  );
}
