"use client";

/**
 * Last-resort boundary: the root layout itself failed (fonts, providers). Replaces the whole document, so it
 * renders its own <html>/<body> with inline styles (globals.css may not have loaded). Details stay in server logs.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f7f3ea", color: "#0d0f0e", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.7 }}>WEGO SHIIIP</p>
          <h1 style={{ fontSize: 32, margin: "8px 0" }}>Something went wrong</h1>
          <p style={{ opacity: 0.8 }}>Your cart is safe. Please try again in a moment.</p>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.6 }}>Reference: <code>{error.digest}</code></p>}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button type="button" onClick={reset} style={{ padding: "12px 24px", borderRadius: 999, border: 0, background: "#0d0f0e", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            {/* Plain <a>: a full reload is the safest recovery when the root layout is broken. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ padding: "12px 24px", borderRadius: 999, border: "1px solid #0d0f0e", color: "inherit", fontWeight: 600, textDecoration: "none" }}>
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
