import { t } from '../lib/language';
export type Row = { id: string; version: number; [key: string]: unknown };
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "datetime-local"
    | "time"
    | "month"
    | "select"
    | "weekdays"
    | "times"
    | "exercises";
  options?: [string, string][];
  initial?: unknown;
  optional?: boolean;
  min?: number;
  max?: number;
  step?: string;
  hint?: string;
};
export type Section = {
  key: string;
  label: string;
  singular: string;
  path: string;
  description: string;
  fields: Field[];
  pro?: boolean;
};
const title: Field = { key: "title", label: t("Название") };
const day: Field = { key: "day", label: t("Дата"), type: "date" };
const money: Field = {
  key: "amount",
  label: t("Сумма"),
  type: "number",
  min: 0.01,
  step: ".01",
};
const currency: Field = {
  key: "currency",
  label: t("Валюта"),
  type: "select",
  initial: "PLN",
  options: [
    ["PLN", t("PLN · злотый")],
    ["EUR", t("EUR · евро")],
    ["USD", t("USD · доллар")],
    ["RUB", t("RUB · рубль")],
    ["UAH", t("UAH · гривна")],
    ["GBP", t("GBP · фунт")],
  ],
};
const notes: Field = {
  key: "notes",
  label: t("Заметки"),
  type: "textarea",
  optional: true,
};
const category: Field = {
  key: "category",
  label: t("Категория"),
  type: "select",
  initial: "other",
  options: [
    ["food", t("Еда")],
    ["transport", t("Транспорт")],
    ["home", t("Дом")],
    ["health", t("Здоровье")],
    ["leisure", t("Досуг")],
    ["other", t("Другое")],
    ["income", t("Доход")],
  ],
};
export const sections: Record<string, Section[]> = {
  goals_habits: [
    {
      key: "habits",
      label: t("Привычки"),
      singular: t("Привычка"),
      path: "/habits",
      description: t("Небольшие действия, которые становятся частью дня."),
      fields: [
        title,
        {
          key: "kind",
          label: t("Как измерять"),
          type: "select",
          initial: "boolean",
          options: [
            ["boolean", t("Да / нет")],
            ["count", t("Количество")],
            ["duration", t("Длительность")],
          ],
        },
        {
          key: "target",
          label: t("Цель на день"),
          type: "number",
          initial: 1,
          min: 0.0001,
          step: ".0001",
        },
        {
          key: "unit",
          label: t("Единица измерения"),
          optional: true,
          hint: t("Например: стаканов, минут, страниц"),
        },
        {
          key: "weekdays",
          label: t("Дни недели"),
          type: "weekdays",
          initial: [0, 1, 2, 3, 4, 5, 6],
        },
        {
          key: "reminder_time",
          label: t("Напомнить в"),
          type: "time",
          optional: true,
        },
      ],
    },
    {
      key: "goals",
      label: t("Цели"),
      singular: t("Цель"),
      path: "/goals",
      description: t("Определите результат и двигайтесь к нему в своём темпе."),
      fields: [
        title,
        {
          key: "description",
          label: t("Что будет считаться успехом"),
          type: "textarea",
          optional: true,
        },
        { key: "due_date", label: t("Срок"), type: "date", optional: true },
        {
          key: "status",
          label: t("Состояние"),
          type: "select",
          initial: "active",
          options: [
            ["active", t("В работе")],
            ["completed", t("Достигнута")],
            ["cancelled", t("Отменена")],
          ],
        },
        {
          key: "progress",
          label: t("Прогресс, %"),
          type: "number",
          min: 0,
          max: 100,
          initial: 0,
        },
      ],
    },
  ],
  health: [
    {
      key: "programs",
      label: t("Программы"),
      singular: t("Программа тренировок"),
      path: "/health/programs",
      pro: true,
      description:
        t("Сохраните свою программу: упражнения, подходы, повторы и вес."),
      fields: [
        title,
        {
          key: "exercises",
          label: t("Упражнения"),
          type: "exercises",
          initial: [{ name: "", sets: 3, reps: 10, kg: null }],
        },
      ],
    },
    {
      key: "sleep",
      label: t("Сон"),
      singular: t("Запись о сне"),
      path: "/health/sleep",
      description: t("Отмечайте время и качество сна. Без оценок и давления."),
      fields: [
        { key: "start_at", label: t("Заснули"), type: "datetime-local" },
        { key: "end_at", label: t("Проснулись"), type: "datetime-local" },
        {
          key: "quality",
          label: t("Качество сна"),
          type: "select",
          initial: "3",
          options: [
            ["1", t("1 · Очень плохо")],
            ["2", t("2 · Плохо")],
            ["3", t("3 · Нормально")],
            ["4", t("4 · Хорошо")],
            ["5", t("5 · Отлично")],
          ],
        },
      ],
    },
    {
      key: "weight",
      label: t("Вес"),
      singular: t("Измерение веса"),
      path: "/health/weight",
      description:
        t("История ваших измерений. Единицу веса можно выбрать в профиле."),
      fields: [
        day,
        {
          key: "kg",
          label: t("Вес, кг"),
          type: "number",
          min: 0.001,
          max: 1000,
          step: ".001",
        },
      ],
    },
    {
      key: "workouts",
      label: t("Тренировки"),
      singular: t("Тренировка"),
      path: "/health/workouts",
      description:
        t("Сохраните, чем занимались и сколько времени уделили движению."),
      fields: [
        title,
        day,
        {
          key: "minutes",
          label: t("Продолжительность, минут"),
          type: "number",
          min: 1,
          max: 1440,
        },
        notes,
      ],
    },
    {
      key: "nutrition",
      label: t("Питание"),
      singular: t("Приём пищи"),
      path: "/health/nutrition",
      pro: true,
      description: t("Записывайте состав и пищевую ценность приёмов пищи."),
      fields: [
        title,
        day,
        {
          key: "meal",
          label: t("Приём пищи"),
          type: "select",
          initial: "lunch",
          options: [
            ["breakfast", t("Завтрак")],
            ["lunch", t("Обед")],
            ["dinner", t("Ужин")],
            ["snack", t("Перекус")],
          ],
        },
        ...["calories", "protein", "fat", "carbs"].map((key, i) => ({
          key,
          label: [t("Калории, ккал"), t("Белки, г"), t("Жиры, г"), t("Углеводы, г")][i],
          type: "number" as const,
          min: 0,
          step: ".01",
          initial: 0,
        })),
      ],
    },
    {
      key: "medications",
      label: t("Лекарства"),
      singular: t("Лекарство"),
      path: "/health/medications",
      pro: true,
      description: t("Ваш список и отметки приёма по назначенной схеме."),
      fields: [
        title,
        { key: "dosage", label: t("Назначенная дозировка") },
        {
          key: "times",
          label: t("Время приёма"),
          type: "times",
          initial: ["09:00"],
          hint: t("Укажите назначенное вам расписание."),
        },
      ],
    },
  ],
  finance: [
    {
      key: "transactions",
      label: t("Операции"),
      singular: t("Операция"),
      path: "/finance/transactions",
      description: t("Доходы и расходы — с понятной историей каждой операции."),
      fields: [
        title,
        day,
        {
          key: "kind",
          label: t("Тип"),
          type: "select",
          initial: "expense",
          options: [
            ["expense", t("Расход")],
            ["income", t("Доход")],
          ],
        },
        money,
        currency,
        category,
        notes,
      ],
    },
    {
      key: "budgets",
      label: t("Бюджеты"),
      singular: t("Бюджет"),
      path: "/finance/budgets",
      pro: true,
      description: t("Установите месячные лимиты по категориям."),
      fields: [
        { key: "month", label: t("Месяц"), type: "month" },
        category,
        { ...money, label: t("Лимит") },
        currency,
      ],
    },
    {
      key: "subscriptions",
      label: t("Подписки"),
      singular: t("Подписка"),
      path: "/finance/subscriptions",
      pro: true,
      description: t("Список регулярных платежей и ближайших дат."),
      fields: [
        title,
        money,
        currency,
        {
          key: "period",
          label: t("Период"),
          type: "select",
          initial: "monthly",
          options: [
            ["weekly", t("Еженедельно")],
            ["monthly", t("Ежемесячно")],
            ["yearly", t("Ежегодно")],
          ],
        },
        { key: "next_payment", label: t("Ближайший платёж"), type: "date" },
      ],
    },
    {
      key: "savings",
      label: t("Накопления"),
      singular: t("Накопление"),
      path: "/finance/savings",
      pro: true,
      description: t("Средства по счетам. Валюты учитываются отдельно."),
      fields: [
        title,
        {
          key: "kind",
          label: t("Где хранятся"),
          type: "select",
          initial: "bank",
          options: [
            ["cash", t("Наличные")],
            ["bank", t("Банк")],
            ["deposit", t("Вклад")],
            ["investment", t("Инвестиции")],
            ["other", t("Другое")],
          ],
        },
        { ...money, min: 0 },
        currency,
      ],
    },
    {
      key: "saving-goals",
      label: t("На мечту"),
      singular: t("Финансовая цель"),
      path: "/finance/goals",
      pro: true,
      description: t("Сколько нужно накопить и к какому сроку."),
      fields: [
        title,
        { ...money, key: "target", label: t("Нужная сумма") },
        { ...money, key: "saved", label: t("Уже отложено"), initial: 0, min: 0 },
        currency,
        { key: "due_date", label: t("Срок"), type: "date" },
      ],
    },
    {
      key: "debts",
      label: t("Долги"),
      singular: t("Долг"),
      path: "/finance/debts",
      pro: true,
      description: t("Сумма обязательства и история частичных погашений."),
      fields: [
        title,
        {
          key: "direction",
          label: t("Кто должен"),
          type: "select",
          initial: "i_owe",
          options: [
            ["i_owe", t("Я должен")],
            ["owed_to_me", t("Мне должны")],
          ],
        },
        money,
        currency,
        { key: "due_date", label: t("Срок"), type: "date", optional: true },
        {
          key: "status",
          label: t("Состояние"),
          type: "select",
          initial: "active",
          options: [
            ["active", t("Активен")],
            ["archived", t("Архив")],
          ],
        },
      ],
    },
  ],
  books: [
    {
      key: "books",
      label: t("Книжная полка"),
      singular: t("Книга"),
      path: "/books",
      description: t("То, что хочется прочитать, и истории, которые уже с вами."),
      fields: [
        title,
        { key: "author", label: t("Автор"), optional: true },
        {
          key: "status",
          label: t("На полке"),
          type: "select",
          initial: "want",
          options: [
            ["want", t("Хочу прочитать")],
            ["reading", t("Читаю")],
            ["read", t("Прочитано")],
          ],
        },
        {
          key: "total_pages",
          label: t("Всего страниц"),
          type: "number",
          optional: true,
          min: 1,
          max: 100000,
        },
        {
          key: "current_page",
          label: t("Прочитано страниц"),
          type: "number",
          min: 0,
          initial: 0,
        },
        {
          key: "rating",
          label: t("Оценка прочитанной книги"),
          type: "number",
          optional: true,
          min: 1,
          max: 5,
        },
        { key: "genre", label: t("Жанр"), optional: true },
        {
          key: "started_on",
          label: t("Начало чтения"),
          type: "date",
          optional: true,
        },
        {
          key: "finished_on",
          label: t("Окончание чтения"),
          type: "date",
          optional: true,
        },
      ],
    },
    {
      key: "diary",
      label: t("Дневник"),
      singular: t("Запись в дневнике"),
      path: "/diary/entries",
      description: t("Место для мыслей, маленьких открытий и важных дней."),
      fields: [
        { ...title, optional: true },
        day,
        { key: "text", label: t("Что хочется сохранить"), type: "textarea" },
        { key: "mood", label: t("Настроение от 1 до 5"), type: "number", min: 1, max: 5, optional: true },
        { key: "tags", label: t("Теги через запятую"), optional: true },
      ],
    },
  ],
};
sections.health.sort(
  (a, b) =>
    [
      "sleep",
      "weight",
      "workouts",
      "programs",
      "nutrition",
      "medications",
    ].indexOf(a.key) -
    [
      "sleep",
      "weight",
      "workouts",
      "programs",
      "nutrition",
      "medications",
    ].indexOf(b.key),
);
export function bodyFor(
  section: Section,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of section.fields) {
    let value = row[f.key];
    if (value === "" || value === undefined) {
      value = f.optional
        ? f.type === "date" || f.type === "number"
          ? null
          : ""
        : (f.initial ?? "");
    }
    if (f.type === "number" && value !== null && value !== "" && !f.step)
      value = Number(value);
    if (f.key === "quality") value = Number(value);
    if (f.type === "datetime-local" && value)
      value = new Date(String(value)).toISOString();
    body[f.key] = value;
  }
  if (section.key === "habits") {
    body.archived = row.archived ?? false;
    body.goal_id = row.goal_id ?? null;
    body.reminder_time = row.reminder_time || null;
  }
  if (section.key === "books") {
    body.cover_id = row.cover_id ?? null;
    body.open_library_key = row.open_library_key ?? null;
    body.notes = row.notes ?? "";
    if (body.status !== "read") body.rating = null;
  }
  if (section.key === "diary") {
    body.tags = Array.isArray(body.tags) ? body.tags : String(body.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean);
  }
  return body;
}
