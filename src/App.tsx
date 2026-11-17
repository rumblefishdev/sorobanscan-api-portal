import { Route, Routes } from "react-router";
import { BuiltBy } from "./sections/BuiltBy";
import { Footer, TopBar } from "./sections/Chrome";
import { Closing } from "./sections/Closing";
import { Faq } from "./sections/Faq";
import { Hero } from "./sections/Hero";
import { HowTheyConnect } from "./sections/HowTheyConnect";
import { Products } from "./sections/Products";
import { SorobanScanApi } from "./sections/SorobanScanApi";
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
        <HowTheyConnect />
        <SorobanScanApi />
        <BuiltBy />
        <Faq />
        <Closing />
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
