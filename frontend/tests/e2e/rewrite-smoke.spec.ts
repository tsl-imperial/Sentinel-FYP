import { test, expect } from '@playwright/test';

/**
 * THE critical smoke test for the dev story.
 *
 * Hits Next.js (port 3000) and expects Flask's /api/healthz response.
 * If this passes, the next.config.js rewrite is correctly proxying /api/* to Flask.
 * If this fails, the entire dev workflow is built on faith.
 */
test('Next.js rewrite proxies /api/healthz to Flask', async ({ request }) => {
  const res = await request.get('/api/healthz');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('Workbench page renders', async ({ page }) => {
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Network Inspector' })).toBeVisible();
});

test('Root redirects to workbench', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/workbench/);
});
