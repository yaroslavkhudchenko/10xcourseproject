// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// The kitchen sink at /dev/product-page renders the product page's components and states from fixtures, for review
// and screenshots. Only `astro dev` gets the route: the build never sees it, so no Worker serves it.
/** @type {import("astro").AstroIntegration} */
const devKitchenSink = {
  name: "dev-kitchen-sink",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command === "dev") {
        injectRoute({ pattern: "/dev/product-page", entrypoint: "./src/dev/product-page.astro" });
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
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
