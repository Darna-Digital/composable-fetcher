import { expect, test } from '@playwright/test';

test.describe('composable fetcher e2e', () => {
  test('blocks invalid input before request and shows input message', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByTestId('item-title').fill('');
    await page.getByTestId('item-count').fill('1');
    await page.getByTestId('submit-item').click();

    await expect(page.getByTestId('form-message')).toContainText('title is required');
    await expect(page.getByTestId('created-item')).toHaveCount(0);
  });

  test('creates item with valid input', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('item-title').fill('Notebook');
    await page.getByTestId('item-count').fill('3');
    await page.getByTestId('submit-item').click();

    await expect(page.getByTestId('form-message')).toHaveText('Created item successfully.');
    await expect(page.getByTestId('created-item')).toContainText('"title": "Notebook"');
    await expect(page.getByTestId('created-item')).toContainText('"count": 3');
  });

  test('shows typed HTTP error from error schema', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('run-http-failure').click();
    await expect(page.getByTestId('failure-result')).toContainText('http:');
    await expect(page.getByTestId('failure-result')).toContainText('title: already exists');
    await expect(page.getByTestId('failure-result')).toContainText('count: limit exceeded');
  });

  test('shows parse error for invalid success payload', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('run-parse-failure').click();
    await expect(page.getByTestId('failure-result')).toContainText('parse:');
  });
});
