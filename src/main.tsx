import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

/** If anything throws while rendering, show what happened and a way out, never a blank screen. */
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  reset = async () => {
    try { localStorage.clear(); } catch {}
    try { const regs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((regs ?? []).map((r) => r.unregister())); } catch {}
    location.reload();
  };
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0b0b0b", color: "#e8e6e1", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Studio hit an error while loading</div>
          <p style={{ color: "#9a9a9a", fontSize: 14, lineHeight: 1.5, margin: "0 0 14px" }}>Your book is safe; it lives on disk. Resetting clears what this browser remembers (open chapter, layout) and reloads.</p>
          <pre style={{ whiteSpace: "pre-wrap", background: "#181818", border: "1px solid #2a2a2a", borderRadius: 8, padding: 12, fontSize: 12, color: "#e5a95c", maxHeight: 200, overflow: "auto" }}>{String(e.message || e)}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={this.reset} style={{ background: "#e5a95c", color: "#111", border: 0, borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer" }}>Reset and reload</button>
            <button onClick={() => location.reload()} style={{ background: "transparent", color: "#e8e6e1", border: "1px solid #333", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Just reload</button>
          </div>
        </div>
      </div>
    );
  }
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary><QueryClientProvider client={qc}><App /></QueryClientProvider></Boundary>
  </React.StrictMode>,
);

// Installable app: only when served by the Studio server itself (production build on :3131), not the Vite dev server.
if ("serviceWorker" in navigator && location.port === "3131") navigator.serviceWorker.register("/sw.js").catch(() => {});
