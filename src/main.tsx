import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><App /></QueryClientProvider>
  </React.StrictMode>,
);

// Installable app: only when served by the Studio server itself (production build on :3131), not the Vite dev server.
if ("serviceWorker" in navigator && location.port === "3131") navigator.serviceWorker.register("/sw.js").catch(() => {});
