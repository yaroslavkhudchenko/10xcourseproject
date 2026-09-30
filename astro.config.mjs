// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// The kitchen sinks at /dev/product-page and /dev/watchlist render the product page's and the list's components and
// states from fixtures, for review and screenshots. Only `astro dev` gets the routes: the build never sees them, so no
// Worker serves them.
/** @type {import("astro").AstroIntegration} */
const devKitchenSink = {
  name: "dev-kitchen-sink",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command === "dev") {
        injectRoute({ pattern: "/dev/product-page", entrypoint: "./src/dev/product-page.astro" });
        injectRoute({ pattern: "/dev/watchlist", entrypoint: "./src/dev/watchlist.astro" });
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap(), devKitchenSink],
  vite: {
    plugins: [tailwindcss()],
  },
  // No Astro sessions or Cloudflare Images yet, so the adapter adds no SESSION KV or IMAGES binding to the Worker.
  session: false,
  adapter: cloudflare({ imageService: "passthrough" }),
  // The web fonts, downloaded from Google at build time and served with the Worker's static assets from
  // /_astro/fonts/, so no page asks Google for them. <Font /> in Layout.astro sets each family's CSS variable, and
  // src/styles/global.css publishes them as font-sans and font-mono. latin-ext holds the Polish letters. A build that
  // can't reach Google still succeeds, with no font files and only a warning, so CI runs scripts/check-built-fonts.mjs,
  // which counts the files these families yield: change its count with them.
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Bricolage Grotesque",
      cssVariable: "--font-bricolage",
      weights: ["400 800"],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      fallbacks: ["sans-serif"],
      // Google's provider drops the optical-size axis unless it's asked for. The option is experimental inside the
      // stable Fonts API, so recheck it on every Astro upgrade.
      options: { experimental: { variableAxis: { opsz: [["12", "96"]] } } },
    },
    {
      provider: fontProviders.google(),
      name: "DM Mono",
      cssVariable: "--font-dm-mono",
      weights: [400, 500],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      fallbacks: ["monospace"],
    },
  ],
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
