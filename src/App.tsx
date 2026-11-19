import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { BuiltBy } from "./sections/BuiltBy";
import { Footer, TopBar } from "./sections/Chrome";
import { Closing } from "./sections/Closing";
import { Faq } from "./sections/Faq";
import { Hero } from "./sections/Hero";
import { HowTheyConnect } from "./sections/HowTheyConnect";
import { Products } from "./sections/Products";
import { SorobanScanApi } from "./sections/SorobanScanApi";
import { WhichApi } from "./sections/WhichApi";

/**
 * Opened at an address that names one of the page's parts (`/api/#products`), the page goes to
 * it. A browser does that by itself only when the part exists as the document loads, and here
 * React draws it after. Once, as the page opens: a link within the page is the browser's own jump.
 */
function useAddressedPart() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape names no part of the page; look for it as written.
    }
    // Optional call: jsdom has no `scrollIntoView`.
    document.getElementById(id)?.scrollIntoView?.();
    // No dependency: the address the page opened at, and nothing after it.
  }, []);
}

/** The hub: one document, its sections in the order the design has them. */
function HubPage() {
  useAddressedPart();
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
