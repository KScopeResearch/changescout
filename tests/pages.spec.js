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
    uxKeySelector: ".kpi-strip",
    uxCtaSelector: ".card-link",
  },
  {
    path: "opportunity-detail.html",
    key: "opportunity detail",
    title: /製造業への新規開拓チャンス/,
    heading: "製造業への新規開拓チャンス",
    uxKeySelector: ".detail-hero__ring-num",
    uxCtaSelector: ".action-item__title",
  },
  {
    path: "company-profile.html",
    key: "company profile",
    title: /ChangeScout Weekly/,
    heading: "会社プロフィールを教えてください",
    uxKeySelector: ".page-title",
    uxCtaSelector: ".btn-primary",
  },
  {
    path: "profile-complete.html",
    key: "profile complete",
    title: /あなた専用分析を作成しました/,
    heading: "あなた専用分析を作成しました",
    uxKeySelector: ".complete-card__title",
    uxCtaSelector: ".btn-primary",
  },
];

const fragmentDir = path.join("test-results", "review-fragments");

for (const { path: pagePath, key, title, heading, uxKeySelector, uxCtaSelector } of pages) {
  test.describe(pagePath, () => {
    test("loads and renders correctly", async ({ page }, testInfo) => {
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      const screenshotFile = `${testInfo.project.name}-${pagePath.replace(".html", "")}.png`;
      const screenshotPath = `screenshots/${screenshotFile}`;
      let passed = false;
      let ux = { loadTimeMs: null, keyValueAboveFold: false, ctaVisible: false };

      try {
        const navStart = Date.now();
        const response = await page.goto(pagePath);
        ux.loadTimeMs = Date.now() - navStart;
        expect(response?.ok(), `${pagePath} should respond with a successful status`).toBeTruthy();

        await expect(page).toHaveTitle(title);
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        await expect(page.getByText("BETA")).toBeVisible();

        expect(consoleErrors, `console errors on ${pagePath}`).toEqual([]);

        // UX check: is the page's core value visible without scrolling, and is the next
        // action clear? Both matter for a first-time user to "get it" within 5 minutes.
        const viewport = page.viewportSize();
        const keyBox = await page.locator(uxKeySelector).first().boundingBox().catch(() => null);
        ux.keyValueAboveFold = Boolean(keyBox && viewport && keyBox.y < viewport.height);
        ux.ctaVisible = await page.locator(uxCtaSelector).first().isVisible().catch(() => false);

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
            ux,
          })
        );
      }
    });
  });
}
