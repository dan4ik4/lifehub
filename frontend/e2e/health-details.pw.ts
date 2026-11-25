import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

const root='/modules/health';
async function login(page:Page) {
  await page.goto('/');
  await page.getByLabel('Электронная почта',{exact:true}).fill('overview-qa@example.com');
  await page.getByLabel('Пароль',{exact:true}).fill('Local-QA-Only-9182!');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page).toHaveURL(/\/home$/);
}
test('Health records work from the forms, charts and schedules',async({page},info)=>{
  await login(page);
  await page.goto(root+'/sleep');
  await expect(page.getByRole('heading',{name:'Ритм сна'})).toBeVisible();
  await expect(page.locator('.health-stat')).toHaveCount(4);
  await page.screenshot({path:info.outputPath('sleep.png')});
  await page.getByRole('button',{name:'Записать сон',exact:true}).click();
  const sleep=page.getByRole('dialog',{name:'Записать сон'});
  const start=await sleep.getByLabel('Дата отбоя').inputValue();
  await sleep.getByLabel('Время отбоя').fill('23:40');
  await sleep.getByLabel('Время пробуждения').fill('00:10');
  const end=await sleep.getByLabel('Дата пробуждения').inputValue();
  expect((Date.parse(end)-Date.parse(start))/86400000).toBe(1);
  await expect(sleep.locator('.health-callout')).toContainText('0 ч 30 мин');
  await sleep.getByRole('button',{name:'4 Хорошо'}).click();
  await sleep.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(sleep).toBeHidden();
  await expect(page.locator('.health-night-list')).toContainText('23:40');
  await page.getByRole('group',{name:'Период сна'}).getByRole('button',{name:'30',exact:true}).click();
  await expect(page.locator('.health-rhythm-row')).toHaveCount(30);

  await page.goto(root+'/weight');
  await expect(page.locator('.health-weight-chart')).toBeVisible();
  await page.getByRole('button',{name:'Записать вес',exact:true}).click();
  const weight=page.getByRole('dialog',{name:'Записать вес'});
  await weight.getByLabel('Вес',{exact:true}).fill('67,2');
  await weight.getByRole('button',{name:'Увеличить вес'}).click();
  await expect(weight.getByLabel('Вес',{exact:true})).toHaveValue(/67[.,]3/);
  await weight.getByLabel('Заметка').fill('Проверка измерения');
  await weight.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(weight).toBeHidden();
  await expect(page.locator('.health-measurements')).toContainText('Проверка измерения');
  await page.locator('.health-weight-chart .health-chart-point').last().click();
  const drawer=page.locator('.health-drawer');
  await expect(drawer).toContainText('Проверка измерения');
  await drawer.getByRole('button',{name:'Закрыть окно'}).click();
  await page.getByLabel('Целевой вес').fill('70');
  await page.getByRole('button',{name:'Набор',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить цель'}).click();
  await expect(page.locator('.health-weight-path')).toContainText('До цели');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Экспорт CSV'}).click();
  expect((await download).suggestedFilename()).toBe('lifehub-weight.csv');
  await page.screenshot({path:info.outputPath('weight.png')});

  await page.goto(root+'/programs');
  await page.locator('.health-title').getByRole('button',{name:'Новая программа'}).click();
  const program=page.getByRole('dialog');
  await program.getByLabel('Название',{exact:true}).fill('Проверка программы');
  for(const [index,name,reps,kg] of [[0,'Тяга','8','30'],[1,'Жим','10','20']] as const){
    if(index>0)await program.getByRole('button',{name:'Добавить упражнение'}).click();
    await program.getByLabel('Упражнение '+(index+1),{exact:true}).fill(name);
    await program.getByLabel('Подходы',{exact:true}).nth(index).fill('2');
    await program.getByLabel('Повторы',{exact:true}).nth(index).fill(reps);
    await program.getByLabel('Вес, кг',{exact:true}).nth(index).fill(kg);
  }
  await program.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(program).toBeHidden();
  const detail=page.locator('.health-program-detail');
  await expect(detail.getByRole('heading',{name:'Проверка программы'})).toBeVisible();
  await detail.getByRole('button',{name:'Изменить порядок: Жим'}).press('ArrowUp');
  await expect(detail.locator('li').first()).toContainText('Жим');
  await page.screenshot({path:info.outputPath('programs.png')});
  await detail.getByRole('button',{name:'Начать тренировку',exact:true}).click();
  const workout=page.getByRole('dialog',{name:'Идёт тренировка'});
  await expect(workout.getByLabel('Упражнение',{exact:true})).toHaveValue('Жим');
  await workout.getByRole('button',{name:'Подход готов'}).click();
  await workout.getByRole('button',{name:'Завершить и сохранить'}).click();
  await expect(workout).toBeHidden();
  await expect(detail.locator('.health-program-facts')).toContainText('200');

  await page.goto(root+'/nutrition');
  await page.getByRole('button',{name:'Добавить еду: Обед',exact:true}).click();
  const meal=page.getByRole('dialog',{name:'Добавить еду'});
  await expect(meal.getByRole('button',{name:'Обед',exact:true})).toHaveAttribute('aria-pressed','true');
  await meal.getByLabel('Что ели').fill('Курица и рис');
  await meal.getByLabel('Калории').fill('650');
  await meal.getByLabel('Белки').fill('48');
  await meal.getByRole('button',{name:'Добавить',exact:true}).click();
  await expect(meal).toBeHidden();
  await expect(page.locator('.health-nutrition-energy')).toContainText('650');
  await page.getByRole('button',{name:'Ориентиры питания'}).click();
  const target=page.getByRole('dialog',{name:'Ориентиры питания'});
  await target.getByLabel('Калории').fill('2400');
  await target.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(page.locator('.health-nutrition-energy')).toContainText('1 750');
  await page.getByRole('button',{name:'Предыдущий день',exact:true}).click();
  await expect(page.locator('.health-meal-entry')).toHaveCount(0);
  await page.getByRole('button',{name:'Следующий день',exact:true}).click();
  await expect(page.locator('.health-meal-entry')).toContainText('Курица и рис');
  await page.screenshot({path:info.outputPath('nutrition.png')});

  await page.goto(root+'/medications');
  await page.getByRole('button',{name:'Добавить лекарство',exact:true}).click();
  const medication=page.getByRole('dialog',{name:'Новое лекарство'});
  await medication.getByLabel('Название',{exact:true}).fill('Учебный курс');
  await medication.getByLabel('Назначенная дозировка').fill('1 тестовая доза');
  await medication.getByRole('button',{name:'Время',exact:true}).click();
  await medication.getByLabel('Время приёма 2').fill('20:00');
  await medication.locator('.health-course-fields input[type=number]').fill('6');
  await medication.getByRole('button',{name:'Добавить',exact:true}).click();
  await expect(medication).toBeHidden();
  await expect(page.locator('.health-dose-list article')).toHaveCount(2);
  await page.locator('.health-dose-list article').first().getByRole('button',{name:'Принять',exact:true}).click();
  await expect(page.locator('.health-course-stock')).toContainText('Осталось приёмов: 5');
  await page.locator('.health-dose-list article').last().getByRole('button',{name:'Пропустить',exact:true}).click();
  await expect(page.locator('.health-dose-list article').last()).toContainText('Пропущено');
  await page.reload();
  await expect(page.locator('.health-dose-list article').last()).toContainText('Пропущено');
  await page.getByRole('button',{name:/Снять отметку: Учебный курс, 08:00/}).click();
  await expect(page.locator('.health-course-stock')).toContainText('Осталось приёмов: 6');
  await page.screenshot({path:info.outputPath('medications.png')});
});

test('new Health screens and modal sheets fit phone, tablet and desktop',async({page},info)=>{
  await login(page);
  for(const width of [1440,1180,390,375]){
    await page.setViewportSize({width,height:850});
    for(const route of ['sleep','weight','programs','nutrition','medications']){
      await page.goto(root+'/'+route);
      await expect(page.locator('.health-main h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await page.locator('.app-main').evaluate(node=>Math.max(node.scrollWidth-node.clientWidth,
        document.documentElement.scrollWidth-innerWidth)),route+' @ '+width).toBeLessThanOrEqual(1);
      const icons=await page.locator('[data-health-icon]:visible').evaluateAll(elements=>elements.map(e=>{
        const rect=e.getBoundingClientRect();
        return [e.getAttribute('data-health-icon'),rect.width,rect.height,getComputedStyle(e).maskImage];
      }));
      expect(icons.length).toBeGreaterThan(2);
      expect(icons.filter(([,w,h,mask])=>w!==h||w===0||mask==='none').map(([name,w,h])=>[name,w,h]),route+' @ '+width).toEqual([]);
    }
  }
  await page.getByRole('navigation',{name:'Разделы здоровья'}).getByRole('button',{name:'Сон',exact:true}).click();
  await page.getByRole('button',{name:'Записать сон',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Записать сон'});
  await expect(modal).toBeVisible();
  expect((await modal.boundingBox())!.width).toBeLessThanOrEqual(375);
  await expect.poll(async()=>{
    const box=await modal.boundingBox();
    return Math.abs(box!.y+box!.height-850);
  }).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('sleep-mobile-form.png')});
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});
