// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// Defaults to the published GitHub Pages site.
// Override for local checks, e.g.:
//   bash:       BASE_URL=http://localhost:8080 npm run check
//   PowerShell: $env:BASE_URL="http://localhost:8080"; npm run check
const BASE_URL = process.env.BASE_URL || "https://kscoperesearch.github.io/changescout/";

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  outputDir: "test-results",

  use: {
    baseURL: BASE_URL,
    screenshot: "on",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
