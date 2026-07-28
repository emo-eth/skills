/**
 * Shared demo helpers for Playwright video recordings.
 *
 * Create this file at e2e/demos/demo-helpers.ts in each package that has
 * demos, then import from your .demo.ts specs:
 *
 *   import { FAKE_CURSOR_SCRIPT, moveCursorUntilVisible, startDemoScene } from "./demo-helpers";
 */
import type { Page, Locator } from "@playwright/test";

// ─── Fake CSS Cursor ────────────────────────────────────────────────────────
// Playwright video does not capture the real mouse cursor. This injects a
// visible red dot that follows mousemove events. Appended directly to
// document.body (outside React root) so overlays with `inert` or
// `pointer-events: none` cannot hide it.
//
// IMPORTANT: Must use DOMContentLoaded guard because addInitScript runs
// before document.body exists.
export const FAKE_CURSOR_SCRIPT = `
  function initCursor() {
    const cursor = document.createElement('div');
    Object.assign(cursor.style, {
      position: 'fixed',
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      backgroundColor: 'rgba(239, 68, 68, 0.9)',
      boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
      pointerEvents: 'none',
      zIndex: '99999',
      transition: 'left 0.1s ease-out, top 0.1s ease-out',
      left: '-20px',
      top: '-20px',
    });
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = (e.clientX - 6) + 'px';
      cursor.style.top = (e.clientY - 6) + 'px';
    });
  }
  if (document.body) initCursor();
  else document.addEventListener('DOMContentLoaded', initCursor);
`;

// ─── Scene Setup ────────────────────────────────────────────────────────────
// Standard preamble for every demo test: inject cursor, navigate, wait for
// React to hydrate. Call this at the start of each test.
export async function startDemoScene(page: Page, route: string) {
  await page.addInitScript(FAKE_CURSOR_SCRIPT);
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

// ─── Page Warm-up ───────────────────────────────────────────────────────────
// Pre-compile Next.js pages in beforeAll to avoid white-screen on first visit.
// Pass the full base URL (beforeAll has no access to test fixtures).
export async function warmUpPages(
  browser: { newPage: () => Promise<Page> },
  baseUrl: string,
  routes: string[],
) {
  const page = await browser.newPage();
  for (const route of routes) {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
  }
  await page.close();
}

// ─── Cursor Movement Loop ───────────────────────────────────────────────────
// Move the cursor along a path of waypoints until a condition is met or
// timeout expires. Keeps the video looking alive during async waits.
export async function moveCursorUntilVisible(
  page: Page,
  target: Locator,
  timeoutMs: number,
  waypoints?: Array<{ x: number; y: number }>,
) {
  const startedAt = Date.now();
  const path = waypoints ?? [
    { x: 230, y: 240 },
    { x: 450, y: 320 },
    { x: 640, y: 285 },
    { x: 820, y: 360 },
    { x: 520, y: 430 },
  ];

  let i = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (await target.isVisible()) return;
    const point = path[i % path.length];
    await page.mouse.move(point.x, point.y, { steps: 10 });
    await page.waitForTimeout(250);
    i += 1;
  }
}
