import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { routerBasename } from "../base-path";
// The Prices portal's self-hosted fonts and theme: the sign-in page and the dashboard look like
// its own (spec, "The page"). Imported here, not linked from `index.html`, for the reason
// `src/prices/main.tsx` gives.
import "../prices/theme/fonts.css";
import { theme } from "../prices/theme/theme";
import { App } from "./App";

/**
 * The account pages, `/login` and `/dashboard`, as `src/boot.js` boots them: a tree of their own,
 * set up as `src/prices/main.tsx` sets up the Prices portal, so MUI and the Prices theme load
 * here and never in the hub's chunk. The router's `basename` is the hub's own prefix (`/api` for
 * `/api/`), so its routes are the hub's addresses.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    {/* `CssBaseline` inside the provider, so the first frame is the theme's dark floor. */}
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
