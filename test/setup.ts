import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts after each test by itself only where `afterEach` is a global. The
// Prices specs were written for Vitest's `globals: true` and never call `cleanup`; this repo
// runs without globals.
afterEach(cleanup);
