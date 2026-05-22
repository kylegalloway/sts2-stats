import { test, expect } from '@playwright/test';
import { seedRun, resetDatabase } from '../fixtures/seed.js';

const SERVER = 'http://localhost:3002';

test.beforeEach(async () => {
  await resetDatabase(SERVER);
});

test.describe('Overview tab', () => {
  test('shows zero-state when database is empty', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Overview' }).click();

    // KPI cards render with 0 values rather than errors
    await expect(page.getByText('0', { exact: true }).first()).toBeVisible();
  });

  test('displays total runs KPI after seeding data', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 12 });
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Overview' }).click();

    // Total runs = 2 should appear somewhere on the page
    await expect(page.getByText('2').first()).toBeVisible();
  });

  test('win rate KPI reflects victories accurately', async ({ page }) => {
    // 1 win out of 4 runs = 25%
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });
    for (let i = 0; i < 3; i++) {
      await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 10 });
    }

    await page.goto('/');
    await page.getByRole('button', { name: 'Overview' }).click();

    await expect(page.locator('.kpi-val').filter({ hasText: /25/ })).toBeVisible();
  });

  test('per-character breakdown shows Ironclad row', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Overview' }).click();

    // The character name appears in the win-by-char table body (not the dropdown option)
    await expect(page.locator('td').filter({ hasText: 'Ironclad' }).first()).toBeVisible();
  });
});
