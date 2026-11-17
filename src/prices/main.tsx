import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import App from './app/app';
// The other half of `base` in `vite.config.mts`, which imports the same module:
// `base` makes the bundle's ASSETS resolve under `/api/prices-api/`, this makes
// its ROUTES do the same. Without it the router reads `/api/prices-api/` as a
// route it has never heard of and renders nothing, on the one URL the app is
// actually served from. See `base-path.ts` for why the two values differ by a
// slash.
import { ROUTER_BASENAME } from './base-path';
// The three self-hosted families (task 0193). Imported here rather than linked
// from `index.html` so Vite fingerprints the `.woff2` files and rewrites their
// URLs under `base` — a `<link>` in the document would ship the paths verbatim
// and 403 on every deploy. No font is fetched from a third-party host; see the
// comment at the top of `theme/fonts.css`.
import './theme/fonts.css';
import { theme } from './theme/theme';

// The Discord sign-in popup never gets here: `src/boot.js` runs the bridge in
// `landing/oauthPopup.ts` first and imports this module only when the
// document is not the popup.
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    {/* `CssBaseline` INSIDE the provider, so it paints the theme's dark floor
        rather than MUI's default white one. Outside it, the first frame of
        every page load is a white flash before the theme applies. */}
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter basename={ROUTER_BASENAME}>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
