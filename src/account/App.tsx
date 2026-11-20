import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";

import { DashboardPage } from "./DashboardPage";
import { DocsPage } from "./docs/DocsPage";
import { LoginPage } from "./LoginPage";
import { PrivacyPolicyPage } from "./PrivacyPolicyPage";
import { useSessionControl } from "./session";

/**
 * An address past an API's page (`/docs/prices/anything`) is that page's own: it goes there, the
 * address's `#part` kept for the documentation's anchors. An API the page doesn't know is then
 * put on the first tab by the page itself, as it is without the extra part.
 */
function ToApiPage({ kind }: { kind: "quick-start" | "docs" }) {
  const { product } = useParams();
  const { hash } = useLocation();
  return <Navigate to={{ pathname: `/${kind}/${product}`, hash }} replace />;
}

/**
 * An address this tree doesn't know goes to the landing page by a page load: the landing page is
 * another tree, which only a load boots, and a router `Navigate` to `/` would meet this route
 * again.
 */
function ToLanding() {
  useEffect(() => {
    window.location.replace(import.meta.env.BASE_URL);
  }, []);
  return null;
}

/**
 * The account pages: `/login` and `/dashboard` (with `/dashboard/<product>` for a tab), one sign-in
 * and one dashboard for every API, and the pages open to everybody, `/quick-start/<product>` and
 * `/docs/<product>` (`docs/DocsPage.tsx`) and `/privacy-policy` (`PrivacyPolicyPage.tsx`). The
 * session is asked for once, here, so the sign-in page's forward to the dashboard doesn't ask again; the sign-in page asks again only after a
 * sign-in in a second window.
 */
export function App() {
  const { session, checkSignedIn } = useSessionControl();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} checkSignedIn={checkSignedIn} />} />
      <Route path="/dashboard/:product?" element={<DashboardPage session={session} />} />
      <Route
        path="/quick-start/:product?"
        element={<DocsPage kind="quick-start" session={session} />}
      />
      <Route path="/docs/:product?" element={<DocsPage kind="docs" session={session} />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage session={session} />} />
      <Route path="/quick-start/:product/*" element={<ToApiPage kind="quick-start" />} />
      <Route path="/docs/:product/*" element={<ToApiPage kind="docs" />} />
      {/* `src/boot.js` boots this tree for the account pages' addresses only; any other address
          the router meets (`/dashboard/prices/extra`) leaves for the landing page. */}
      <Route path="*" element={<ToLanding />} />
    </Routes>
  );
}
