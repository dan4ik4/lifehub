import {expect, test} from '@playwright/test';

test.use({hasTouch: true});

test('overview widgets keep touch, keyboard and drag changes across reload', async ({page}) => {
  page.setDefaultTimeout(15_000);
  await page.goto('/');
  await page.getByLabel('Электронная почта', {exact: true}).fill('overview-qa@example.com');
  await page.getByLabel('Пароль', {exact: true}).fill('Local-QA-Only-9182!');
  await page.getByRole('button', {name: 'Войти', exact: true}).click();
  await expect(page).toHaveURL(/\/home$/);

  const arrange = page.getByRole('button', {name: 'Настроить виджеты'});
  const dialog = page.getByRole('dialog', {name: 'Настроить виджеты'});
  const done = dialog.getByRole('button', {name: 'Готово', exact: true});
  await page.setViewportSize({width: 375, height: 850});
  await page.goto('/modules/health');
  await arrange.tap();
  await dialog.getByRole('button', {name: 'Поднять: Вес', exact: true}).first().tap();
  await done.tap();
  await expect(page.locator('.hub-health-grid > button').first()).toContainText('Вес');
  await page.reload();
  await expect(page.locator('.hub-health-grid > button').first()).toContainText('Вес');

  await page.setViewportSize({width: 1280, height: 850});
  await page.goto('/modules/finance');
  await arrange.click();
  const expense = dialog.getByRole('button', {name: 'Поднять: Расходы'});
  await expense.focus();
  await expense.press('ArrowUp');
  await expense.press('ArrowUp');
  await done.click();
  await expect(page.locator('.life-finance-totals > section').first()).toContainText('Расходы');
  await page.reload();
  await expect(page.locator('.life-finance-totals > section').first()).toContainText('Расходы');

  await page.goto('/modules/books');
  await arrange.click();
  const items = dialog.getByRole('listitem');
  await items.last().dragTo(items.first());
  await done.click();
  await expect(page.locator('.life-reading-grid > section').first()).toHaveClass(/life-reading-goal/);
  await page.reload();
  await expect(page.locator('.life-reading-grid > section').first()).toHaveClass(/life-reading-goal/);
});
