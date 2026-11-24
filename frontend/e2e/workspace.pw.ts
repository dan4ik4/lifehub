import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Электронная почта', { exact: true }).fill('overview-qa@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('Local-QA-Only-9182!');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('.life-home-habits')).toBeVisible();
});

test('create a task and an event, then check off a habit and reload', async ({ page }) => {
  await page.goto('/planning');
  await page.locator('.tasks-panel').getByRole('button', { name: 'Новая задача' }).click();
  let editor = page.getByRole('dialog');
  await editor.getByLabel('Название', { exact: true }).fill('Проверка задачи E2E');
  await editor.getByRole('button', { name: 'Создать задачу' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Все задачи', exact: true }).click();
  await expect(page.getByText('Проверка задачи E2E', { exact: true }).first()).toBeVisible();

  await page.goto('/planning/calendar');
  await page.getByRole('button', { name: 'Событие', exact: true }).click();
  editor = page.getByRole('dialog');
  await editor.getByLabel('Название', { exact: true }).fill('Проверка события E2E');
  const created = page.waitForResponse(r => r.url().endsWith('/planning/events') && r.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Создать событие' }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(editor).toHaveCount(0);

  await page.goto('/modules/goals_habits');
  await page.getByRole('button', { name: 'Отметить: Утренняя прогулка' }).click();
  const checked = page.getByRole('button', { name: 'Отменить отметку: Утренняя прогулка' });
  await expect(checked).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(checked).toHaveAttribute('aria-pressed', 'true');
});

const routes = [
  '/home', '/planning', '/planning/calendar', '/planning/free-time', '/planning/lists',
  ...['','/habits','/goals','/stats'].map(tab => '/modules/goals_habits' + tab),
  ...['','/sleep','/weight','/workouts','/programs','/nutrition','/medications'].map(tab => '/modules/health' + tab),
  ...['','/transactions','/budgets','/subscriptions','/savings','/saving-goals','/debts','/analysis'].map(tab => '/modules/finance' + tab),
  '/modules/books', '/modules/books/diary', '/modules/insights', '/modules/insights/comparisons', '/modules/insights/review',
];

test('module pages fit desktop, tablet and phone', async ({ page }) => {
  const errors: string[] = [];
  const reads = new Map<string, number>();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' || !/\/api\/v1\/(health\/summary|finance\/overview|books\/stats|users\/me\/(avatar|assistant-preferences))$/.test(url.pathname)) return;
    url.searchParams.sort();
    reads.set(url.href, (reads.get(url.href) ?? 0) + 1);
  });
  page.on('response', r => {
    if (r.url().includes('/api/v1/') && r.status() >= 400) errors.push(r.status() + ' ' + r.url());
  });
  for (const width of [1440, 1180, 375]) {
    await page.setViewportSize({width, height: 850});
    for (const route of routes) {
      reads.clear();
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      expect.soft([...reads.entries()].filter(([,count]) => count > 1), route + ' shared requests @ ' + width).toEqual([]);
      const main = page.locator('.app-main');
      await expect.soft(main, route).toBeVisible();
      const overflow = await page.evaluate(() => {
        const box = document.querySelector('.app-main')!;
        return Math.max(document.documentElement.scrollWidth - innerWidth, box.scrollWidth - box.clientWidth);
      });
      expect.soft(overflow, route + ' @ ' + width).toBeLessThanOrEqual(1);
      if (route.endsWith('/habits')) {
        const title = page.locator('.gh-habit-copy h3').first();
        expect.soft((await title.boundingBox())?.width, route + ' title @ ' + width).toBeGreaterThan(64);
      }
      if (width === 375) {
        if (route === '/planning' || route === '/planning/lists') {
          const tooSmall = await main.locator('.today-week-strip .icon-button, .quick-add-submit, .task-filters button, .list-item-row .icon-button, .list-item-row .check-button')
            .evaluateAll(elements => elements.flatMap(element => {
              const rect=element.getBoundingClientRect();
              return rect.width && rect.height && (rect.width < 43.9 || rect.height < 43.9)
                ? [element.getAttribute('aria-label') || element.textContent] : [];
            }));
          expect.soft(tooSmall, route + ' touch targets').toEqual([]);
        }
        const dock = await page.locator('.life-tab-bar').boundingBox();
        const content = await main.boundingBox();
        expect.soft(content!.y + content!.height, route + ' mobile dock').toBeLessThanOrEqual(dock!.y + 1);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('shopping checklist and reading bookmark survive reload on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/planning/lists');
  const title = 'Куриная грудка ' + Date.now();
  await page.getByLabel('Новый пункт списка').fill(title);
  await page.locator('.inline-add').getByRole('button', { name: 'Добавить' }).click();
  const item = page.getByRole('button', { name: title, exact: true });
  await expect(page.locator('.life-list-group').filter({ has: page.getByRole('heading', { name: /Мясо и рыба/ }) }).getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Режим магазина', exact: true }).click();
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.life-list-group').filter({ has: page.getByRole('heading', { name: /Готово/ }) }).getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Снять отметку: ' + title })).toBeChecked();

  await page.goto('/modules/books');
  const openBookmark = page.getByRole('button', { name: 'Закладка', exact: true });
  await openBookmark.click();
  const bookmark = page.getByRole('dialog', { name: 'Закладка' });
  await bookmark.getByLabel('Прочитано страниц').fill('147');
  await bookmark.getByLabel('Заметки о книге').fill('Синтетическая заметка для проверки');
  await bookmark.getByRole('button', { name: 'Добавить цитату' }).click();
  await bookmark.getByLabel('Цитата со страницы 147').fill('Начать с одного шага');
  await bookmark.getByRole('button', { name: 'Сохранить' }).click();
  await expect(bookmark).toHaveCount(0);
  await page.reload();
  await openBookmark.click();
  await expect(bookmark.getByLabel('Прочитано страниц')).toHaveValue('147');
  await expect(bookmark.getByLabel('Заметки о книге')).toHaveValue('Синтетическая заметка для проверки\n\nСтр. 147 — «Начать с одного шага»');

  await page.goto('/modules/books/diary');
  const diary = page.locator('.life-section-diary');
  await expect(diary).toBeVisible();
  await expect(diary.getByRole('button', { name: '', exact: true })).toHaveCount(0);
});

test('completed tasks switch between the selected day and history', async ({ page }) => {
  await page.goto('/planning');
  const panel = page.locator('.tasks-panel');
  const done = panel.getByRole('button', { name: 'Готово', exact: true });
  const completedTask = panel.getByText('Прочитать 20 страниц', { exact: true });
  await done.click();
  await expect(completedTask).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущая неделя задач' }).click();
  await expect(completedTask).toHaveCount(0);
  await panel.getByRole('button', { name: 'История' }).click();
  await expect(completedTask).toBeVisible();
  await page.locator('.today-week-strip .week-day').first().click();
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await expect(completedTask).toHaveCount(0);
});


test('finance groups, English preference and browser session survive navigation', async ({ page, context }) => {
  const cookies = (await context.cookies()).filter(cookie => /lifehub_(access|refresh)_/.test(cookie.name));
  expect(cookies).toHaveLength(2);
  expect(cookies.every(cookie => cookie.httpOnly)).toBeTruthy();
  const stored = await page.evaluate(() => [localStorage, sessionStorage].map(storage => storage.getItem('lifehub.session.v1')));
  expect(stored.some(Boolean)).toBeTruthy();
  for (const entry of stored) {
    if (!entry) continue;
    const session = JSON.parse(entry);
    expect(session.tokens).not.toHaveProperty('access_token');
    expect(session.tokens).not.toHaveProperty('refresh_token');
  }

  await page.goto('/modules/finance');
  const navigation = page.locator('.life-context-links');
  await expect(navigation.getByRole('button')).toHaveCount(5);
  await navigation.getByRole('button', {name:'Бюджеты'}).click();
  const children = page.getByRole('navigation', {name:'Подразделы финансов'});
  await children.getByRole('button', {name:'Подписки'}).click();
  await expect(page).toHaveURL(/\/finance\/subscriptions$/);
  await expect(navigation.getByRole('button', {name:'Бюджеты'})).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', {name:'Настройки профиля', exact:true}).click();
  await page.getByLabel('Язык интерфейса').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('heading', {name:'Subscriptions',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', {name:'Subscriptions',exact:true})).toBeVisible();
});

test('manual book addition can open a shelf match or save a separate edition', async ({ page }) => {
  await page.goto('/modules/books');
  const editor = page.getByRole('dialog', { name: 'Добавить · книга' });
  const enterBook = async () => {
    await page.getByRole('button', { name: 'Добавить книгу', exact: true }).click();
    await editor.getByLabel('Название', { exact: true }).fill('Атомные привычки');
    await editor.getByLabel(/Автор/).fill('Джеймс Клир');
    await editor.getByRole('button', { name: 'Сохранить' }).click();
    await expect(editor.getByText('Книга с таким названием и автором уже есть на полке.')).toBeVisible();
  };
  await enterBook();
  await editor.getByRole('button', { name: 'Открыть книгу на полке' }).click();
  const existing = page.getByRole('dialog', { name: 'Атомные привычки' });
  await expect(existing).toBeVisible();
  await existing.getByRole('button', { name: 'Закрыть окно' }).click();
  await enterBook();
  const saved = page.waitForResponse(r => r.url().endsWith('/books') && r.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Добавить ещё одно издание' }).click();
  expect((await saved).status()).toBe(201);
  await expect(editor).toHaveCount(0);
});
