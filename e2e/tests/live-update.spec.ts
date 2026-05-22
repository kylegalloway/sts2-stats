import { test, expect } from '@playwright/test';
import { seedRun, resetDatabase } from '../fixtures/seed.js';

const SERVER = 'http://localhost:3002';

test.beforeEach(async () => {
  await resetDatabase(SERVER);
});

test.describe('Live update via SSE', () => {
  test('Run Log updates when a new run is seeded while the page is open', async ({ page }) => {
    // Given: page is open with no data
    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    // Wait for the page to finish its initial data fetch (SSE keeps the connection
    // open so networkidle never fires — wait for a DOM landmark instead)
    await page.waitForSelector('.content, .loading', { timeout: 10_000 });

    // When: a run is seeded server-side (simulating the game writing a .run file)
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });

    // Then: the UI reflects the new run without a manual refresh
    await expect(page.locator('.tcard-head').getByText('1 runs')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('td').filter({ hasText: 'Ironclad' }).first()).toBeVisible();
  });

  test('Overview KPIs update when a run is added while the page is open', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 10 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.waitForSelector('.kpi-val', { timeout: 10_000 });

    // Seed a second run while the page is open
    await seedRun(SERVER, { character: 'Silent', victory: true, floors: 25 });

    // The total runs count should update to 2
    await expect(page.getByText('2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('SSE connection is established on page load', async ({ page }) => {
    // Check that /api/events shows a connected client after the page opens
    await page.goto('/');
    await page.waitForSelector('.content, .loading, .kpi-val', { timeout: 10_000 });

    const status = await fetch(`${SERVER}/api/status`).then((r) => r.json()) as { sse_clients: number };
    expect(status.sse_clients).toBeGreaterThanOrEqual(1);
  });
});
