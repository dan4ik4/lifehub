import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

const root = '/modules/insights';

async function checkIcons(page: Page) {
  const icons = page.locator('.results-layout [data-icon]:visible');
  expect(await icons.count()).toBeGreaterThan(0);
  const failures = await icons.evaluateAll(async elements => {
    const problems: string[] = [];
    const assets = new Map<string, Promise<HTMLImageElement>>();
    for (const element of elements) {
      const style = getComputedStyle(element);
      const url = style.maskImage.match(/^url\("(.*)"\)$/)?.[1];
      const name = element.getAttribute('data-icon')!;
      const rect = element.getBoundingClientRect();
      if (!url || !rect.width || Math.abs(rect.width - rect.height) > 0.5) {
        problems.push(name);
        continue;
      }
      if (!assets.has(url)) {
        const img = new Image();
        img.src = url;
        assets.set(url, img.decode().then(() => img));
      }
      try {
        const img = await assets.get(url)!;
        if (!img.naturalWidth || !img.naturalHeight) problems.push(name);
      } catch {
        problems.push(name);
      }
      const tile = element.parentElement?.closest('.results-tile, .results-icon-button');
      if (tile) {
        const parent = tile.getBoundingClientRect();
        if (Math.abs(parent.x + parent.width / 2 - rect.x - rect.width / 2) > 1 ||
            Math.abs(parent.y + parent.height / 2 - rect.y - rect.height / 2) > 1) problems.push(name + ' alignment');
      }
    }
    return problems;
  });
  expect(failures).toEqual([]);
  for (const button of await page.locator('.results-layout .results-main button:visible, .results-context button:visible').all()) {
    await expect(button).toHaveAccessibleName(/\S/);
  }
}

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Электронная почта', {exact:true}).fill('results-qa@example.com');
  await page.getByLabel('Пароль', {exact:true}).fill('Local-QA-Only-9182!');
  await page.getByRole('button', {name:'Войти', exact:true}).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('desktop Results shows the stored week, working links, archive and account consent', async ({page, context}, info) => {
  const receivedErrors: string[] = [];
  page.on('pageerror', error => receivedErrors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/v1/insights/') && !response.ok()) {
      receivedErrors.push(response.status() + ' ' + response.url());
    }
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', {name:/Неделя готова/}).click();
  const consent = page.getByRole('dialog', {name:'ИИ-итоги'});
  await consent.getByRole('button', {name:'Продолжить без ИИ'}).click();
  await expect(consent).toBeHidden();
  await expect(page.locator('.results-kpi')).toHaveCount(6);
  await expect(page.locator('.results-heat-cell')).toHaveCount(35);
  await expect(page.locator('.results-day-tile')).toHaveCount(2);
  await expect(page.locator('.results-consent-chip')).toContainText('ИИ-итоги выключены');
  await checkIcons(page);
  await page.screenshot({path:info.outputPath('week.png'), fullPage:true, animations:'disabled'});

  const previous = page.getByRole('button', {name:'Предыдущая неделя'});
  const next = page.getByRole('button', {name:'Следующая неделя'});
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(page).toHaveURL(/\?start=\d{4}-\d\d-\d\d/);
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toBeDisabled();

  await page.getByRole('button', {name:'Поделиться', exact:true}).click();
  const share = page.getByRole('dialog', {name:'Поделиться итогами'});
  const shared = await share.getByRole('textbox', {name:'Текст итогов'}).inputValue();
  expect(shared).toMatch(/Оценка недели/);
  await share.getByRole('button', {name:'Скопировать текст'}).click();
  await expect(share).toBeHidden();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(shared);

  await page.getByRole('button', {name:'Создать привычку'}).click();
  const habit = page.getByRole('dialog', {name:'Новая привычка'});
  await expect(habit.getByRole('textbox', {name:'Что будете делать?'})).toHaveValue('Сон до 23:30');
  await expect(habit.locator('fieldset button[aria-pressed=true]')).toHaveCount(5);
  await page.goBack();
  await page.getByRole('button', {name:'Открыть бюджет'}).click();
  await expect(page).toHaveURL(/\/finance\/budgets\?.*category=food/);
  await expect(page.getByText('Еда', {exact:true}).first()).toBeVisible();
  await page.goBack();
  await page.getByRole('button', {name:'Перенести задачу'}).click();
  await expect(page).toHaveURL(/\/planning\?day=\d{4}-\d\d-\d\d/);
  await page.goBack();

  await page.getByText('Недельный обзор дневника', {exact:true}).click();
  await expect(page.getByRole('region', {name:'Недельный обзор дневника'})).toBeVisible();
  await page.getByRole('button', {name:'Настройки', exact:true}).click();
  const settings = page.getByRole('dialog', {name:'Настройки'});
  await settings.locator('.results-settings').getByRole('button').click();
  await consent.getByRole('button', {name:'Включить ИИ-итоги'}).click();
  await expect(settings.locator('.results-settings')).toContainText('ИИ-итоги включены');
  await settings.getByRole('button', {name:'Закрыть окно'}).click();
  await expect(page.locator('.results-consent-chip')).toContainText('ИИ-итоги включены');

  await page.getByRole('button', {name:'Все недели'}).click();
  await expect(page).toHaveURL(/\/archive$/);
  await expect(page.locator('.results-trend-bar')).toHaveCount(7);
  await checkIcons(page);
  await page.screenshot({path:info.outputPath('archive.png'), fullPage:true, animations:'disabled'});
  await page.locator('.results-archive-row').first().click();
  await expect(page).toHaveURL(/insights\?start=/);
  await page.getByRole('button', {name:'Архив', exact:true}).first().click();
  await page.locator('.results-trend-bar').first().click();
  await expect(page).toHaveURL(/insights\?start=/);
  await page.getByRole('button', {name:'Архив', exact:true}).first().click();
  await page.getByRole('button', {name:'Месяцы', exact:true}).click();
  await expect(page).toHaveURL(/kind=month/);
  await page.locator('.results-month-row').first().click();
  const month = page.locator('.results-month-dialog');
  await expect(month.getByRole('button', {name:'Разобрать месяц с ИИ'})).toBeVisible();
  await month.getByRole('button', {name:'Закрыть окно'}).click();

  await page.goto('/home');
  await page.getByRole('button', {name:/Новая связь/}).click();
  await expect(page).toHaveURL(/\/links\?pair=sleep%3Ahabits/);
  await expect(page.locator('.results-pair')).toHaveCount(2);
  await checkIcons(page);
  await page.screenshot({path:info.outputPath('links.png'), fullPage:true, animations:'disabled'});
  await page.getByRole('button', {name:'14 дней', exact:true}).click();
  await expect(page.locator('.results-history-cells > span')).toHaveCount(14);
  await page.getByRole('button', {name:'28 дней', exact:true}).click();
  await expect(page.locator('.results-history-cells > span')).toHaveCount(28);
  await page.getByRole('button', {name:'Основания сравнения'}).first().click();
  const evidence = page.getByRole('dialog', {name:'Основания сравнения'});
  expect(await evidence.locator('tbody tr').count()).toBeGreaterThanOrEqual(8);
  await evidence.getByRole('button', {name:'Закрыть окно'}).click();
  await page.getByRole('button', {name:'Подробнее', exact:true}).click();
  const method = page.getByRole('dialog', {name:'Как считаем связи'});
  await expect(method).toBeVisible();
  await method.getByRole('button', {name:'Закрыть окно'}).click();

  const filter = page.getByRole('dialog', {name:'Модули'});
  const modules = page.locator('.results-heading-actions').getByRole('button', {name:/Модули/});
  await page.locator('.results-pair').first().getByRole('button', {name:'Скрыть', exact:true}).click();
  await expect(page.locator('.results-pair')).toHaveCount(1);
  await modules.click();
  await filter.getByText('Скрытые связи', {exact:true}).click();
  await filter.getByRole('button', {name:/Снова показать/}).click();
  await expect(page.locator('.results-pair')).toHaveCount(2);
  await filter.getByRole('checkbox', {name:'Финансы', exact:true}).uncheck();
  await filter.getByRole('button', {name:'Применить'}).click();
  await expect(page.locator('.results-pair')).toHaveCount(1);
  await modules.click();
  await filter.getByRole('button', {name:'Все модули'}).click();
  await expect(page.locator('.results-pair')).toHaveCount(2);

  await page.getByRole('button', {name:'Привычка «Сон до 23:30»'}).click();
  await expect(habit).toBeVisible();
  await page.goBack();
  await page.getByRole('button', {name:'Открыть траты'}).click();
  await expect(page).toHaveURL(/finance\/transactions\?.*kind=expense/);
  await page.goBack();
  await page.getByRole('button', {name:'Подключить', exact:true}).click();
  await expect(page).toHaveURL(/health\?connect=1/);
  await expect(page.locator('#health-device')).toBeInViewport();
  await page.goBack();
  await page.getByRole('button', {name:/Спросить помощника/}).click();
  await expect(page.getByRole('log', {name:'История переписки'})).toBeVisible();
  expect(receivedErrors).toEqual([]);
});

test('phone Results keeps icons and tab changes aligned at 390 and 375 pixels', async ({page}, info) => {
  await page.setViewportSize({width:390,height:844});
  const preferences = page.waitForResponse(response => response.url().endsWith('/insights/preferences') && response.ok());
  await page.goto(root);
  const consent = page.getByRole('dialog', {name:'ИИ-итоги'});
  if (!(await (await preferences).json()).decided) await consent.getByRole('button', {name:'Продолжить без ИИ'}).click();
  await expect(page.locator('.results-kpi')).toHaveCount(6);
  await expect(page.locator('.results-week-grid')).toBeHidden();
  await checkIcons(page);
  await page.screenshot({path:info.outputPath('week-mobile.png'), fullPage:true, animations:'disabled'});
  await page.getByRole('button', {name:'Поделиться', exact:true}).click();
  await expect(page.getByRole('dialog', {name:'Поделиться итогами'})).toBeVisible();
  await page.getByRole('button', {name:'Закрыть окно'}).click();

  await page.setViewportSize({width:375,height:844});
  const navigation = page.getByRole('navigation', {name:'Разделы итогов'});
  for (const [name,content] of [['Связи','.results-pair'],['Архив','.results-archive-row'],['Неделя','.results-kpi']]) {
    await navigation.getByRole('button', {name, exact:true}).click();
    await expect(page.locator(content).first()).toBeVisible();
    const overflow = await page.locator('.app-main').evaluate(el =>
      Math.max(el.scrollWidth - el.clientWidth, document.documentElement.scrollWidth-innerWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    await checkIcons(page);
  }
});
