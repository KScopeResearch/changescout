// @ts-check
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const pages = [
  {
    path: "mock-dashboard.html",
    key: "dashboard",
    title: /ChangeScout Weekly/,
    heading: "貴社のビジネスチャンス",
  },
  {
    path: "opportunity-detail.html",
    key: "opportunity detail",
    title: /製造業への新規開拓チャンス/,
    heading: "製造業への新規開拓チャンス",
  },
];

const fragmentDir = path.join("test-results", "review-fragments");

for (const { path: pagePath, key, title, heading } of pages) {
  test.describe(pagePath, () => {
    test("loads and renders correctly", async ({ page }, testInfo) => {
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      const screenshotFile = `${testInfo.project.name}-${pagePath.replace(".html", "")}.png`;
      const screenshotPath = `screenshots/${screenshotFile}`;
      let passed = false;

      try {
        const response = await page.goto(pagePath);
        expect(response?.ok(), `${pagePath} should respond with a successful status`).toBeTruthy();

        await expect(page).toHaveTitle(title);
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        await expect(page.getByText("BETA")).toBeVisible();

        expect(consoleErrors, `console errors on ${pagePath}`).toEqual([]);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        passed = true;
      } finally {
        fs.mkdirSync(fragmentDir, { recursive: true });
        fs.writeFileSync(
          path.join(fragmentDir, `${testInfo.project.name}-${key.replace(/\s+/g, "-")}.json`),
          JSON.stringify({
            label: `${testInfo.project.name} ${key}`,
            project: testInfo.project.name,
            page: pagePath,
            url: page.url(),
            screenshot: `../screenshots/${screenshotFile}`,
            passed,
            consoleErrors: consoleErrors.length,
          })
        );
      }
    });
  });
}
