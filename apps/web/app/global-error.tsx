"use client";

import { useEffect } from "react";

/*
  The last boundary. This one catches failures in the root layout itself —
  the theme boot script, the providers, the font loader — which the `(app)`
  boundary cannot, because it lives inside the tree that failed.

  Next replaces the entire document when this renders, so it has to supply its
  own <html> and <body>. That also means none of the app's CSS is loaded: the
  styles here are inline on purpose, and must stay that way. A stylesheet
  reference would be one more thing that can fail at exactly the moment
  everything else already has.

  Deliberately plain. This should be the page nobody sees, and if they do, it
  needs to render with no dependencies whatsoever.
*/
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[root] render error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fff",
          color: "#18181b",
        }}
      >
        <main style={{ maxWidth: "34rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            STInventory could not start
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#52525b", margin: "0 0 1.5rem" }}>
            Something failed before the app finished loading. Nothing was changed
            and no record was lost. Reloading usually clears it.
          </p>
          <button
            onClick={retry}
            style={{
              border: "1px solid #d4d4d8",
              borderRadius: "0.375rem",
              background: "#fafafa",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", color: "#71717a" }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
