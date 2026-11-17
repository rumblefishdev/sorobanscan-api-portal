import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * The only test that exercises `main.tsx`, and the only one that can fail if
 * `basename` is dropped from the router.
 *
 * `app.spec.tsx` mounts `App` inside a `MemoryRouter` the test itself
 * configures, so it proves the routes work under a prefix without ever proving
 * that the real entry point passes one. This mounts the actual entry point at
 * the actual URL the app is served from: with `basename` in place the `/` route
 * matches and the heading renders; without it `BrowserRouter` reads
 * `/api/prices-api/` as a path it has no route for and renders an empty tree — which
 * is precisely the production failure that is invisible everywhere else.
 */
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: false }),
    }),
  );
  // `main.tsx` renders into this and throws on a null element by design.
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  // BrowserRouter reads `window.location`, so the URL has to be the one the
  // distribution actually serves before the module is imported. Written out
  // rather than read from `BASE_PATH`, which is now derived from the bundle's
  // base: a derivation gone wrong would move this URL with it.
  window.history.pushState({}, '', '/api/prices-api/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  // The `<title>` and robots `<meta>` the app hoists there, so each test
  // finds only its own. Only those: emotion keeps its `<style>` tags in the
  // head across tests.
  document.head
    .querySelectorAll('title, meta[name="robots"]')
    .forEach((element) => element.remove());
  window.history.pushState({}, '', '/');
});

it('mounts the app at the prefix the bundle is served from', async () => {
  // The import IS the render — `main.tsx` calls `createRoot(...).render(...)` at
  // module scope — so it has to happen inside `act` or React warns that a state
  // update escaped it.
  await act(async () => {
    await import('./main');
  });

  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy(),
  );
  expect(await screen.findByText(/not yet available/i)).toBeTruthy();
});

// The page shares the hub's `index.html` now, so its title and `noindex` come
// from the app rather than from a document of its own.
it('names the page and keeps it out of search results', async () => {
  // As the shared `index.html` has it: the hub's title, which the app's must
  // replace rather than follow.
  const hubTitle = document.createElement('title');
  hubTitle.textContent = 'Soroban Scan APIs';
  document.head.appendChild(hubTitle);

  await act(async () => {
    await import('./main');
  });

  await waitFor(() =>
    expect(document.title).toBe('Stellar Prices API — API keys'),
  );
  expect(
    document.head
      .querySelector('meta[name="robots"]')
      ?.getAttribute('content'),
  ).toBe('noindex');
});
