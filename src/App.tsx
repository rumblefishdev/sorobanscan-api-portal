import { Route, Routes } from "react-router";
import { Footer, TopBar } from "./sections/Chrome";
import { Hero } from "./sections/Hero";
import { Products } from "./sections/Products";
import { WhichApi } from "./sections/WhichApi";

/** The hub: one document, its sections in the order the design has them. */
function HubPage() {
  return (
    <>
      <TopBar />
      <main id="top">
        <Hero />
        <Products />
        <WhichApi />
      </main>
      <Footer />
    </>
  );
}

/**
 * The page's routes, under whichever router holds them: the browser's, or a test's. The hub is
 * the only page, so an address under the prefix that it doesn't know shows the hub too.
 */
export function App() {
  return (
    <Routes>
      <Route path="*" element={<HubPage />} />
    </Routes>
  );
}
