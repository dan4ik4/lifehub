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
const title: Field = { key: "title", label: "Название" };
const day: Field = { key: "day", label: "Дата", type: "date" };
const money: Field = {
  key: "amount",
  label: "Сумма",
  type: "number",
  min: 0.01,
  step: ".01",
};
const currency: Field = {
  key: "currency",
  label: "Валюта",
  type: "select",
  initial: "PLN",
  options: [
    ["PLN", "PLN · злотый"],
    ["EUR", "EUR · евро"],
    ["USD", "USD · доллар"],
    ["RUB", "RUB · рубль"],
    ["UAH", "UAH · гривна"],
    ["GBP", "GBP · фунт"],
  ],
};
const notes: Field = {
  key: "notes",
  label: "Заметки",
  type: "textarea",
  optional: true,
};
const category: Field = {
  key: "category",
  label: "Категория",
  type: "select",
  initial: "other",
  options: [
    ["food", "Еда"],
    ["transport", "Транспорт"],
    ["home", "Дом"],
    ["health", "Здоровье"],
    ["leisure", "Досуг"],
    ["other", "Другое"],
    ["income", "Доход"],
  ],
};
export const sections: Record<string, Section[]> = {
  goals_habits: [
    {
      key: "habits",
      label: "Привычки",
      singular: "Привычка",
      path: "/habits",
      description: "Небольшие действия, которые становятся частью дня.",
      fields: [
        title,
        {
          key: "kind",
          label: "Как измерять",
          type: "select",
          initial: "boolean",
          options: [
            ["boolean", "Да / нет"],
            ["count", "Количество"],
            ["duration", "Длительность"],
          ],
        },
        {
          key: "target",
          label: "Цель на день",
          type: "number",
          initial: 1,
          min: 0.0001,
          step: ".0001",
        },
        {
          key: "unit",
          label: "Единица измерения",
          optional: true,
          hint: "Например: стаканов, минут, страниц",
        },
        {
          key: "weekdays",
          label: "Дни недели",
          type: "weekdays",
          initial: [0, 1, 2, 3, 4, 5, 6],
        },
        {
          key: "reminder_time",
          label: "Напомнить в",
          type: "time",
          optional: true,
        },
      ],
    },
    {
      key: "goals",
      label: "Цели",
      singular: "Цель",
      path: "/goals",
      description: "Определите результат и двигайтесь к нему в своём темпе.",
      fields: [
        title,
        {
          key: "description",
          label: "Что будет считаться успехом",
          type: "textarea",
          optional: true,
        },
        { key: "due_date", label: "Срок", type: "date", optional: true },
        {
          key: "status",
          label: "Состояние",
          type: "select",
          initial: "active",
          options: [
            ["active", "В работе"],
            ["completed", "Достигнута"],
            ["cancelled", "Отменена"],
          ],
        },
        {
          key: "progress",
          label: "Прогресс, %",
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
      label: "Программы",
      singular: "Программа тренировок",
      path: "/health/programs",
      pro: true,
      description:
        "Сохраните свою программу: упражнения, подходы, повторы и вес.",
      fields: [
        title,
        {
          key: "exercises",
          label: "Упражнения",
          type: "exercises",
          initial: [{ name: "", sets: 3, reps: 10, kg: null }],
        },
      ],
    },
    {
      key: "sleep",
      label: "Сон",
      singular: "Запись о сне",
      path: "/health/sleep",
      description: "Отмечайте время и качество сна. Без оценок и давления.",
      fields: [
        { key: "start_at", label: "Заснули", type: "datetime-local" },
        { key: "end_at", label: "Проснулись", type: "datetime-local" },
        {
          key: "quality",
          label: "Качество сна",
          type: "select",
          initial: "3",
          options: [
            ["1", "1 · Очень плохо"],
            ["2", "2 · Плохо"],
            ["3", "3 · Нормально"],
            ["4", "4 · Хорошо"],
            ["5", "5 · Отлично"],
          ],
        },
      ],
    },
    {
      key: "weight",
      label: "Вес",
      singular: "Измерение веса",
      path: "/health/weight",
      description:
        "История ваших измерений. Единицу веса можно выбрать в профиле.",
      fields: [
        day,
        {
          key: "kg",
          label: "Вес, кг",
          type: "number",
          min: 0.001,
          max: 1000,
          step: ".001",
        },
      ],
    },
    {
      key: "workouts",
      label: "Тренировки",
      singular: "Тренировка",
      path: "/health/workouts",
      description:
        "Сохраните, чем занимались и сколько времени уделили движению.",
      fields: [
        title,
        day,
        {
          key: "minutes",
          label: "Продолжительность, минут",
          type: "number",
          min: 1,
          max: 1440,
        },
        notes,
      ],
    },
    {
      key: "nutrition",
      label: "Питание",
      singular: "Приём пищи",
      path: "/health/nutrition",
      pro: true,
      description: "Записывайте состав и пищевую ценность приёмов пищи.",
      fields: [
        title,
        day,
        {
          key: "meal",
          label: "Приём пищи",
          type: "select",
          initial: "lunch",
          options: [
            ["breakfast", "Завтрак"],
            ["lunch", "Обед"],
            ["dinner", "Ужин"],
            ["snack", "Перекус"],
          ],
        },
        ...["calories", "protein", "fat", "carbs"].map((key, i) => ({
          key,
          label: ["Калории, ккал", "Белки, г", "Жиры, г", "Углеводы, г"][i],
          type: "number" as const,
          min: 0,
          step: ".01",
          initial: 0,
        })),
      ],
    },
    {
      key: "medications",
      label: "Лекарства",
      singular: "Лекарство",
      path: "/health/medications",
      pro: true,
      description: "Ваш список и отметки приёма по назначенной схеме.",
      fields: [
        title,
        { key: "dosage", label: "Назначенная дозировка" },
        {
          key: "times",
          label: "Время приёма",
          type: "times",
          initial: ["09:00"],
          hint: "Укажите назначенное вам расписание.",
        },
      ],
    },
  ],
  finance: [
    {
      key: "transactions",
      label: "Операции",
      singular: "Операция",
      path: "/finance/transactions",
      description: "Доходы и расходы — с понятной историей каждой операции.",
      fields: [
        title,
        day,
        {
          key: "kind",
          label: "Тип",
          type: "select",
          initial: "expense",
          options: [
            ["expense", "Расход"],
            ["income", "Доход"],
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
      label: "Бюджеты",
      singular: "Бюджет",
      path: "/finance/budgets",
      pro: true,
      description: "Установите месячные лимиты по категориям.",
      fields: [
        { key: "month", label: "Месяц", type: "month" },
        category,
        { ...money, label: "Лимит" },
        currency,
      ],
    },
    {
      key: "subscriptions",
      label: "Подписки",
      singular: "Подписка",
      path: "/finance/subscriptions",
      pro: true,
      description: "Список регулярных платежей и ближайших дат.",
      fields: [
        title,
        money,
        currency,
        {
          key: "period",
          label: "Период",
          type: "select",
          initial: "monthly",
          options: [
            ["weekly", "Еженедельно"],
            ["monthly", "Ежемесячно"],
            ["yearly", "Ежегодно"],
          ],
        },
        { key: "next_payment", label: "Ближайший платёж", type: "date" },
      ],
    },
    {
      key: "savings",
      label: "Накопления",
      singular: "Накопление",
      path: "/finance/savings",
      pro: true,
      description: "Средства по счетам. Валюты учитываются отдельно.",
      fields: [
        title,
        {
          key: "kind",
          label: "Где хранятся",
          type: "select",
          initial: "bank",
          options: [
            ["cash", "Наличные"],
            ["bank", "Банк"],
            ["deposit", "Вклад"],
            ["investment", "Инвестиции"],
            ["other", "Другое"],
          ],
        },
        { ...money, min: 0 },
        currency,
      ],
    },
    {
      key: "saving-goals",
      label: "На мечту",
      singular: "Финансовая цель",
      path: "/finance/goals",
      pro: true,
      description: "Сколько нужно накопить и к какому сроку.",
      fields: [
        title,
        { ...money, key: "target", label: "Нужная сумма" },
        { ...money, key: "saved", label: "Уже отложено", initial: 0, min: 0 },
        currency,
        { key: "due_date", label: "Срок", type: "date" },
      ],
    },
    {
      key: "debts",
      label: "Долги",
      singular: "Долг",
      path: "/finance/debts",
      pro: true,
      description: "Сумма обязательства и история частичных погашений.",
      fields: [
        title,
        {
          key: "direction",
          label: "Кто должен",
          type: "select",
          initial: "i_owe",
          options: [
            ["i_owe", "Я должен"],
            ["owed_to_me", "Мне должны"],
          ],
        },
        money,
        currency,
        { key: "due_date", label: "Срок", type: "date", optional: true },
        {
          key: "status",
          label: "Состояние",
          type: "select",
          initial: "active",
          options: [
            ["active", "Активен"],
            ["archived", "Архив"],
          ],
        },
      ],
    },
  ],
  books: [
    {
      key: "books",
      label: "Книжная полка",
      singular: "Книга",
      path: "/books",
      description: "То, что хочется прочитать, и истории, которые уже с вами.",
      fields: [
        title,
        { key: "author", label: "Автор", optional: true },
        {
          key: "status",
          label: "На полке",
          type: "select",
          initial: "want",
          options: [
            ["want", "Хочу прочитать"],
            ["reading", "Читаю"],
            ["read", "Прочитано"],
          ],
        },
        {
          key: "total_pages",
          label: "Всего страниц",
          type: "number",
          optional: true,
          min: 1,
          max: 100000,
        },
        {
          key: "current_page",
          label: "Прочитано страниц",
          type: "number",
          min: 0,
          initial: 0,
        },
        {
          key: "rating",
          label: "Оценка прочитанной книги",
          type: "number",
          optional: true,
          min: 1,
          max: 5,
        },
        { key: "genre", label: "Жанр", optional: true },
        {
          key: "started_on",
          label: "Начало чтения",
          type: "date",
          optional: true,
        },
        {
          key: "finished_on",
          label: "Окончание чтения",
          type: "date",
          optional: true,
        },
      ],
    },
    {
      key: "diary",
      label: "Дневник",
      singular: "Запись в дневнике",
      path: "/diary/entries",
      description: "Место для мыслей, маленьких открытий и важных дней.",
      fields: [
        { ...title, optional: true },
        day,
        { key: "text", label: "Что хочется сохранить", type: "textarea" },
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
  return body;
}
