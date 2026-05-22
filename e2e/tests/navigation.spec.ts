import { test, expect } from '@playwright/test';
import { seedRun, resetDatabase } from '../fixtures/seed.js';

const SERVER = 'http://localhost:3002';

test.beforeEach(async () => {
  await resetDatabase(SERVER);
  await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 12 });
});

test.describe('Tab navigation', () => {
  test('all tabs are present in the nav', async ({ page }) => {
    await page.goto('/');
    const tabs = ['Overview', 'Cards', 'Relics', 'Potions', 'Synergies', 'Enemies', 'HP & Gold', 'Run Log'];
    for (const tab of tabs) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('clicking Run Log shows the run table', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();
    await expect(page.getByText('Run Log').first()).toBeVisible();
    await expect(page.locator('.tcard-head').getByText(/runs/)).toBeVisible();
  });

  test('active tab is highlighted', async ({ page }) => {
    await page.goto('/');
    const overviewBtn = page.getByRole('button', { name: 'Overview' });
    await expect(overviewBtn).toHaveClass(/active/);

    await page.getByRole('button', { name: 'Run Log' }).click();
    await expect(page.getByRole('button', { name: 'Run Log' })).toHaveClass(/active/);
    await expect(overviewBtn).not.toHaveClass(/active/);
  });

  test('Cards tab loads without errors', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.locator('.content, .loading').first()).toBeVisible();
  });

  test('Enemies tab loads without errors', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enemies' }).click();
    // Should show either loading or some content — not a crash
    await expect(page.locator('.content, .loading')).toBeVisible();
  });
});
