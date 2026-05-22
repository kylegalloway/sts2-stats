import { test, expect } from '@playwright/test';
import { seedRun, resetDatabase } from '../fixtures/seed.js';

const SERVER = 'http://localhost:3002';

test.beforeEach(async () => {
  await resetDatabase(SERVER);
});

test.describe('Run Log tab', () => {
  test('shows seeded runs in the table', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 12 });
    await seedRun(SERVER, { character: 'Silent', victory: true, floors: 25 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await expect(page.locator('.tcard-head').getByText(/runs/)).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'Ironclad' }).first()).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'Silent' }).first()).toBeVisible();
  });

  test('Win badge appears for victorious runs', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await expect(page.locator('.badge-win')).toBeVisible();
  });

  test('Loss badge appears for losing runs', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 10 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await expect(page.locator('.badge-loss')).toBeVisible();
  });

  test('Result filter shows only wins', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 10 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await expect(page.locator('.tcard-head').getByText('2 runs')).toBeVisible();

    // Filter to wins only
    await page.locator('label').filter({ hasText: 'Result' }).locator('select').selectOption('win');
    await expect(page.locator('.tcard-head').getByText('1 runs')).toBeVisible();
    await expect(page.locator('.badge-win')).toBeVisible();
    await expect(page.locator('.badge-loss')).not.toBeVisible();
  });

  test('Result filter shows only losses', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: true, floors: 20 });
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 10 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await page.locator('label').filter({ hasText: 'Result' }).locator('select').selectOption('loss');
    await expect(page.locator('.tcard-head').getByText('1 runs')).toBeVisible();
    await expect(page.locator('.badge-loss')).toBeVisible();
    await expect(page.locator('.badge-win')).not.toBeVisible();
  });

  test('character filter shows only matching character', async ({ page }) => {
    await seedRun(SERVER, { character: 'Ironclad', victory: false, floors: 12 });
    await seedRun(SERVER, { character: 'Silent', victory: true, floors: 20 });

    await page.goto('/');
    await page.getByRole('button', { name: 'Run Log' }).click();

    await expect(page.locator('.tcard-head').getByText('2 runs')).toBeVisible();

    // Select Ironclad in the character dropdown (first select in the controls)
    await page.locator('.controls select').first().selectOption('IRONCLAD');
    await expect(page.locator('.tcard-head').getByText('1 runs')).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'Ironclad' }).first()).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'Silent' })).not.toBeVisible();
  });
});
