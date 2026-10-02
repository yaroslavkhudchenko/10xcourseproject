// Waits until a page's named Astro island is interactive. Astro drops an island's `ssr` attribute once it has hydrated,
// and names the island's component in its `opts`. This DOM query is the one hydration signal the specs use; keep it here.
// Wait for the island a step needs, never for every island: below 1024 px the list row's RowTag
// (client:media="(min-width: 64rem)") never hydrates, so "no astro-island[ssr] left" never comes on a phone.
import type { Page } from "@playwright/test";

/** Resolves once every island of the given component on the page (its name in the .astro tag) has hydrated. */
export async function waitForIsland(page: Page, component: string): Promise<void> {
  await page.waitForFunction((name) => {
    const islands = [...document.querySelectorAll("astro-island")].filter((island) =>
      (island.getAttribute("opts") ?? "").includes(`"name":"${name}"`),
    );
    return islands.length > 0 && islands.every((island) => !island.hasAttribute("ssr"));
  }, component);
}
