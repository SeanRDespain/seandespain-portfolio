import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://seandespain.com",
  // the manager portal and the form's thank-you page never belong in search
  integrations: [sitemap({ filter: (page) => !page.includes("/manager") && !page.includes("/contact/thanks") })],
});
