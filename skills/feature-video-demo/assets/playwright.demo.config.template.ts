/**
 * Playwright config for demo recordings.
 *
 * Matches *.demo.ts files in e2e/demos/. Videos saved automatically.
 *
 * Usage:
 *   PW_DEV_SERVER=true npx playwright test --config playwright.demo.config.ts [--headed]
 */
import { defineConfig, devices } from "@playwright/test";

// Update this to match the package's conventional E2E port.
const e2ePort = process.env.E2E_PORT ?? "3000";
const baseUrl = `http://localhost:${e2ePort}`;

// If the app needs E2E-specific env vars (e.g., Clerk auth, API host),
// build an env string here and prepend it to the webServer command:
//
// const e2eModeEnv = [
//   `NEXT_PUBLIC_E2E_MODE=true`,
//   `NEXT_PUBLIC_TEST_MODE=true`,
//   `NEXT_PUBLIC_API_HOST=http://localhost:8080`,
// ].join(" ");

export default defineConfig({
  testDir: "./e2e/demos",
  testMatch: "**/*.demo.ts",
  fullyParallel: false, // Sequential for cleaner video output
  timeout: 60000,
  retries: 0, // Demos should work deterministically
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: baseUrl,
    video: "on",
    launchOptions: {
      slowMo: 500, // Makes interactions visible in video
      // Uncomment for headless rendering without GPU (CI):
      // args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command:
      process.env.PW_DEV_SERVER === "true"
        ? `E2E_PORT=${e2ePort} bun run dev:e2e`
        : `E2E_PORT=${e2ePort} bun run build:e2e && E2E_PORT=${e2ePort} bun run start:e2e`,
    url: baseUrl,
    reuseExistingServer: process.env.PW_REUSE_SERVER === "true",
    timeout: 120000,
  },
  projects: [
    {
      name: "demo",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
