import { Navigate, Route, Routes } from "react-router";

import { DashboardPage } from "./DashboardPage";
import { LoginPage } from "./LoginPage";
import { useSession } from "./session";

/**
 * The account pages: `/login` and `/dashboard` (with `/dashboard/<product>` for a tab), one sign-in
 * and one dashboard for every API. The session is asked for once, here, so the sign-in page's
 * forward to the dashboard doesn't ask again.
 */
export function App() {
  const session = useSession();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} />} />
      <Route path="/dashboard/:product?" element={<DashboardPage session={session} />} />
      {/* `src/boot.js` boots this tree for those addresses only; anything else the router meets
          is the dashboard's to decide (it sends a stranger to `/login`). */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
