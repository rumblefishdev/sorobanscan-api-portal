// The Prices portal's one build setting, as its `vite-env.d.ts` declared it: the backend's
// origin, empty or absent for relative URLs (`api-origin.ts`).
interface ImportMetaEnv {
  readonly VITE_PORTAL_API_ORIGIN?: string;
}
