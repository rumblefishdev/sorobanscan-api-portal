import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/manrope";
import "@fontsource-variable/space-grotesk";
import "./styles.css";

/**
 * The x402 Facilitator's landing page, as `src/boot.js` boots it at `/api/x402-facilitator/` and
 * every address under it: one page with no router, its own stylesheet and the hub's three fonts.
 * Moved in from stellar-x402's `apps/portal-web`, where it was its own bundle.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
