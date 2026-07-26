// @ts-check
const { test, expect } = require("@playwright/test");

const pages = [
  {
    path: "mock-dashboard.html",
    title: /ChangeScout Weekly/,
    heading: "業界別ビジネスチャンス指数",
  },
  {
    path: "opportunity-detail.html",
    title: /補助金対象拡大/,
    heading: "補助金対象拡大",
  },
];

for (const { path, title, heading } of pages) {
  test.describe(path, () => {
    test("loads and renders correctly", async ({ page }, testInfo) => {
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      const response = await page.goto(path);
      expect(response?.ok(), `${path} should respond with a successful status`).toBeTruthy();

      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText("BETA")).toBeVisible();

      expect(consoleErrors, `console errors on ${path}`).toEqual([]);

      await page.screenshot({
        path: `screenshots/${testInfo.project.name}-${path.replace(".html", "")}.png`,
        fullPage: true,
      });
    });
  });
}
