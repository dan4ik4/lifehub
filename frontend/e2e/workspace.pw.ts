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


test('finance groups, language preferences and browser session survive navigation', async ({ page, context, browser }) => {
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

  await page.getByRole('button', {name:'Profile settings', exact:true}).click();
  await page.getByLabel('Interface language').selectOption('pl');
  await expect(page.locator('html')).toHaveAttribute('lang','pl');
  await expect(page.getByRole('heading', {name:'Subskrypcje',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', {name:'Subskrypcje',exact:true})).toBeVisible();

  await page.setViewportSize({width:375,height:850});
  for (const [route, heading] of [
    ['/planning', 'Mój dzień'],
    ['/modules/health/sleep','Sen'],
    ['/modules/books/diary','Dziennik'],
    ['/modules/finance/subscriptions','Subskrypcje'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', {name:heading,exact:true}).first()).toBeVisible();
    const horizontalOverflow = await page.locator('.app-main').evaluate(node => node.scrollWidth-node.clientWidth);
    expect(horizontalOverflow, route).toBeLessThanOrEqual(1);
  }
  await page.goto('/privacypolicy-pl.html');
  await expect(page.getByRole('heading', {name:'Dane dotyczące zdrowia'})).toBeVisible();

  const signedOut = await browser.newPage();
  try {
    await signedOut.goto(new URL('/', page.url()).href);
    await signedOut.getByLabel('Язык интерфейса').selectOption('pl');
    await expect(signedOut.getByLabel('Adres e-mail', {exact:true})).toBeVisible();
    await expect(signedOut.getByRole('button', {name:'Zaloguj się', exact:true})).toBeVisible();
    await signedOut.reload();
    await expect(signedOut.getByLabel('Język interfejsu')).toHaveValue('pl');
  } finally {
    await signedOut.close();
  }
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

test('mobile profile opens in view mode and resizes a large avatar before upload', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', { name: 'Профиль', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Настройки' });
  await expect(dialog.locator('.settings-profile-overview').getByText('Александр', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Как вас называть')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Редактировать профиль' }).click();
  await expect(dialog.getByLabel('Как вас называть')).toHaveValue('Александр');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();

  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 600;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(600, 600);
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = Math.random() * 256;
      image.data[index + 1] = Math.random() * 256;
      image.data[index + 2] = Math.random() * 256;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL().split(',')[1];
  });
  const buffer = Buffer.from(data, 'base64');
  expect(buffer.byteLength).toBeGreaterThan(650_000);
  const upload = page.waitForResponse(response => response.url().endsWith('/users/me/avatar') && response.request().method() === 'POST');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'large-avatar.png', mimeType: 'image/png', buffer });
  expect((await upload).ok()).toBeTruthy();
  await expect(dialog.getByRole('img', { name: 'Ваше фото профиля' })).toBeVisible();
});

test('opening and closing Luna preserves the layout and scroll position', async ({ page }) => {
  await page.goto('/modules/health');
  const heading = page.locator('.product-title h1');
  await expect(heading).toBeVisible();
  await expect(page.locator('.hub-health-metric')).toHaveCount(4);
  const before = await heading.boundingBox();
  const icon = page.locator('.hub-health-metric .life-metric-heading>span').first();
  const badgeBox = (await icon.boundingBox())!;
  const iconBox = (await icon.locator('svg').boundingBox())!;
  expect(Math.abs(iconBox.x + iconBox.width / 2 - badgeBox.x - badgeBox.width / 2)).toBeLessThanOrEqual(1);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole('button', { name: 'Открыть чат с помощником' }).click();
  const dialog = page.getByRole('dialog', { name: 'Помощник', exact: true });
  await expect(dialog).toBeVisible();
  expect((await heading.boundingBox())?.x).toBe(before?.x);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await dialog.getByRole('button', { name: 'Закрыть окно' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await heading.boundingBox())?.x).toBe(before?.x);
});

test('a goal can record and update its linked numeric habit on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/modules/goals_habits/goals');
  await page.getByRole('button', { name: 'Своя цель' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Чего хотите достичь?').fill('Накопить 10000 zł');
  await dialog.getByLabel('Как измерять результат').selectOption('number');
  await dialog.getByLabel('Хочу достичь').fill('10000');
  await dialog.getByLabel('Единица', { exact: true }).fill('zł');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const goal = page.locator('.gh-goal').filter({ hasText: 'Накопить 10000 zł' });
  await goal.getByRole('button', { name: 'Привычка для этой цели' }).click();
  dialog = page.getByRole('dialog', { name: 'Новая привычка' });
  await dialog.getByLabel('Что будете делать?').fill('Отложить 100 zł');
  await expect(dialog.getByLabel('Как отмечать')).toHaveValue('count');
  await expect(dialog.getByLabel('Единица', { exact: true })).toHaveValue('zł');
  await expect(dialog.getByRole('checkbox', { name: 'Учитывать отмеченное количество в прогрессе цели' })).toBeChecked();
  await dialog.getByLabel('План на день').fill('100');
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'height', { configurable: true, value: 300 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(dialog).toHaveAttribute('data-keyboard-open', '');
  await save.scrollIntoViewIfNeeded();
  const saveRect = await save.boundingBox();
  expect(saveRect!.y + saveRect!.height).toBeLessThanOrEqual(300);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });

  const mark = goal.getByRole('button', { name: /Отметить за/ });
  await mark.click();
  dialog = page.getByRole('dialog', { name: 'Отложить 100 zł' });
  await expect(dialog.getByLabel('Всего за день', { exact: false })).toHaveValue('100');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(goal.locator('.gh-goal-amount')).toContainText('1%');
  await mark.click();
  await dialog.getByLabel('Всего за день', { exact: false }).fill('200');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(goal.locator('.gh-goal-amount')).toContainText('2%');
  await page.reload();
  await expect(goal.locator('.gh-goal-amount')).toContainText('2%');
});

test('logout returns to the sign-in form even when the server does not answer', async ({ page, context }) => {
  await page.route('**/api/v1/auth/logout', () => {});
  await page.locator('.life-rail-avatar:visible').first().click();
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  const email = page.getByLabel('Электронная почта', { exact: true });
  await expect(email).toBeVisible({ timeout: 8_000 });
  await page.reload();
  await expect(email).toBeVisible();

  await page.unroute('**/api/v1/auth/logout');
  await page.setViewportSize({ width: 375, height: 760 });
  await email.fill('overview-qa@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('Local-QA-Only-9182!');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('button', { name: 'Профиль', exact: true }).click();
  const logout = page.waitForResponse(response => response.url().endsWith('/auth/logout') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  const response = await logout;
  expect(response.status()).toBe(204);
  expect((await response.headerValues('set-cookie')).filter(value => /Max-Age=0/.test(value))).toHaveLength(2);
  await expect(email).toBeVisible();
  const storage = await context.storageState();
  expect(storage.origins.flatMap(origin => origin.localStorage).some(item => item.name === 'lifehub.session.v1')).toBeFalsy();
});
