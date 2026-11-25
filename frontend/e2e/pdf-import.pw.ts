import {expect, test} from '@playwright/test';

test('a monthly PDF can finish after closing the dialog and selection persists across preview pages', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/');
  await page.getByLabel('Электронная почта', {exact:true}).fill('overview-qa@example.com');
  await page.getByLabel('Пароль', {exact:true}).fill('Local-QA-Only-9182!');
  await page.getByRole('button', {name:'Войти', exact:true}).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.route('**/api/v1/users/me/assistant-preferences', route=>route.fulfill({json:{messages:true,modules:true,media:false}}));

  const pending = {id:'11111111-1111-4111-8111-111111111111', account:'Проверка PDF', source_format:'pdf',
    status:'processing', expired:false, result:null, rows:[]};
  const ready = {...pending, status:'pending', rows:Array.from({length:52},(_,row)=>({
    row, source:'Synthetic statement source', pages:[1+Math.floor(row/4)], warning:'', error:null, selected:false,
    duplicate:false, transaction:{day:'2026-11-05', title:'Тест '+(row+1), kind:'expense', amount:'12.30',currency:'PLN',category:'food',notes:''},
  }))};
  let current:typeof pending | typeof ready | null = null;
  await page.route('**/api/v1/finance/pdf-imports', async route=>{
    expect(route.request().postDataJSON()).toMatchObject({account:'Проверка PDF',currency:'PLN',consent:true});
    current=pending;
    await route.fulfill({json:pending});
  });
  await page.route('**/api/v1/finance/csv-imports?summary=true', route=>route.fulfill({json:{items:current?[{...current,rows:[]}]:[]}}));
  await page.route(`**/api/v1/finance/csv-imports/${pending.id}`, route=>route.fulfill({json:current}));
  await page.route(`**/api/v1/finance/csv-imports/${pending.id}/confirm`, route=>{
    const saved = route.request().postDataJSON().rows;
    expect(saved).toHaveLength(26);
    expect(saved.at(-1).row).toBe(25);
    return route.fulfill({json:{...ready,status:'applied',result:{added:saved.length,skipped_duplicates:0}}});
  });

  await page.goto('/modules/finance/transactions');
  const open = page.getByRole('button', {name:'Импорт выписки'});
  await open.click();
  const dialog = page.getByRole('dialog', {name:'Банковская выписка'});
  await dialog.getByLabel('Счёт', {exact:true}).fill('Проверка PDF');
  await dialog.getByLabel('Файл', {exact:true}).setInputFiles({name:'monthly.pdf', mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7')});
  await dialog.getByRole('checkbox', {name:/Разрешаю передать текст/}).check();
  await dialog.getByRole('button', {name:'Разобрать выписку'}).click();
  await expect(dialog.getByRole('status')).toHaveText(/обрабатывается по частям/);
  await dialog.getByRole('button', {name:'Закрыть', exact:true}).click();
  await expect(dialog).toBeHidden();

  await open.click();
  await dialog.getByRole('button', {name:/Проверка PDF.*Разбирается/}).click();
  await expect(dialog.getByRole('status')).toHaveText(/обрабатывается по частям/);
  current=ready;
  const pages = dialog.getByRole('navigation', {name:'Страницы предпросмотра'});
  await expect(pages).toContainText('Страница 1 из 3');
  await expect(dialog.locator('.csv-row')).toHaveCount(25);
  await expect(dialog.locator('.csv-row header input:checked')).toHaveCount(0);
  await pages.getByRole('button', {name:'Отметить операции на этой странице'}).click();
  await pages.getByRole('button', {name:'Вперёд'}).click();
  await expect(pages).toContainText('Страница 2 из 3');
  await dialog.locator('.csv-row header input').first().check();
  await dialog.getByRole('button', {name:'Сохранить выбранные (26)'}).click();
  await expect(dialog.getByRole('status')).toContainText('Сохранено: 26');
});
