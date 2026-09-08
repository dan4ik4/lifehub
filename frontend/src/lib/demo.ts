import { RRule } from 'rrule';
import type { AuthSession, CalendarEvent, CalendarRange, ListItem, PlanningList, Recurrence, Reminder, Task, TaskOccurrence, User } from './types';
import type { ApiOptions } from './api';

export class DemoError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'DemoError';
  }
}

interface DemoState {
  schema: 1;
  user: User;
  tasks: Task[];
  events: CalendarEvent[];
  lists: PlanningList[];
  items: ListItem[];
  completions: Record<string, Record<string, string>>;
  cancellations: Record<string, string[]>;
}

type Body = Record<string, unknown>;
const STORE_KEY = 'lifehub.demo.v1';
const DAY = 86_400_000;
let memory: DemoState | null = null;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string): never => { throw new DemoError(status, code, message); };
const invalid = (message: string): never => fail(422, 'demo_validation', message);
const missing = (): never => fail(404, 'not_found', 'Запись не найдена.');

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    let value = formatters.get(timezone);
    if (!value) {
      value = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      formatters.set(timezone, value);
    }
    return value;
  } catch { return invalid('Выберите существующий часовой пояс.'); }
}

// RRULE works on floating wall-clock dates; conversion keeps 09:00 at 09:00
// across daylight-saving transitions instead of repeating at a fixed UTC hour.
function wallTime(instant: number, timezone: string): number {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}

function instantAt(wall: number, timezone: string): number | null {
  const candidates = new Set<number>();
  for (const delta of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
    const reference = wall + delta;
    const offset = wallTime(reference, timezone) - reference;
    const candidate = wall - offset;
    if (wallTime(candidate, timezone) === wall) candidates.add(candidate);
  }
  return candidates.size ? Math.min(...candidates) : null;
}

function timestamp(value: unknown, field: string, nullable = true): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return invalid(`Укажите корректные дату и время: ${field}.`);
  return new Date(value).toISOString();
}

function textValue(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) return invalid(`${field}: введите от 1 до ${max} символов.`);
  return value.trim();
}

function optionalText(value: unknown, max = 20000): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max) return invalid(`Текст должен быть не длиннее ${max} символов.`);
  return value.trim() || null;
}

function bodyOf(value: unknown): Body {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Ожидались заполненные поля формы.');
  return value as Body;
}

function onlyFields(body: Body, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid('В запросе есть неизвестные поля.');
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') return invalid('Проверьте переключатели формы.');
  return value;
}

function checkVersion(item: { version: number }, version: unknown, required = false): void {
  if (version === undefined || version === null) {
    if (required) invalid('Обновите запись перед сохранением.');
    return;
  }
  if (!Number.isInteger(Number(version)) || Number(version) < 1) invalid('Некорректная версия записи.');
  if (Number(version) !== item.version) fail(409, 'version_conflict', 'Запись изменилась. Обновите её и повторите действие.');
}

function touch<T extends { version: number; updated_at: string }>(item: T): T {
  item.version += 1;
  item.updated_at = now();
  return item;
}

function normalizedRule(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return invalid('Укажите правило повторения или отключите повторение.');
  const rule = value.trim().toUpperCase().replace(/^RRULE:/, '');
  if (/[\r\n:]/.test(rule)) return invalid('Нужно одно правило повторения RRULE.');
  const values = rule.split(';').map(part => part.split('='));
  const keys = values.map(part => part[0]);
  if (values.some(part => part.length !== 2) || new Set(keys).size !== keys.length || !keys.includes('FREQ') || (keys.includes('COUNT') && keys.includes('UNTIL'))) return invalid('Проверьте правило повторения.');
  for (const [key, value] of values) {
    if (['COUNT', 'INTERVAL'].includes(key) && (!/^\d+$/.test(value) || +value < 1 || +value > 2147483647)) invalid('Частота и число повторений должны быть положительными.');
  }
  try { RRule.fromString(rule); } catch { return invalid('Не удалось прочитать правило повторения.'); }
  return rule;
}

function occurrences(rule: string, anchor: string, timezone: string, lower: number, upper: number, excluded = new Set<string>(), firstOnly = false): string[] {
  const options = RRule.parseString(rule);
  const count = options.count;
  delete options.count;
  options.dtstart = new Date(wallTime(Date.parse(anchor), timezone));
  if (options.until) options.until = new Date(wallTime(options.until.getTime(), timezone));
  const result: string[] = [];
  let valid = 0;
  new RRule(options).all((candidate, index) => {
    if (index >= 50000) fail(422, 'recurrence_too_complex', 'Слишком много повторений. Упростите правило.');
    const instant = candidate.getTime() === options.dtstart!.getTime() ? Date.parse(anchor) : instantAt(candidate.getTime(), timezone);
    if (instant === null) return true;
    valid += 1;
    if ((count && valid > count) || instant >= upper) return false;
    if (instant >= lower) {
      const iso = new Date(instant).toISOString();
      if (!excluded.has(iso)) {
        result.push(iso);
        if (result.length > 5000) fail(422, 'invalid_or_large_range', 'Слишком много записей в выбранном периоде.');
        if (firstOnly) return false;
      }
    }
    return true;
  });
  return result;
}

function describeRule(rrule: string): string {
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'По будням';
  const values = Object.fromEntries(rrule.split(';').map(part => part.split('=')));
  const label: Record<string, string> = { DAILY: 'Каждый день', WEEKLY: 'Каждую неделю', MONTHLY: 'Каждый месяц', YEARLY: 'Каждый год', HOURLY: 'Каждый час', MINUTELY: 'Каждую минуту', SECONDLY: 'Каждую секунду' };
  return (label[values.FREQ] || 'Повторяется') + (values.INTERVAL && values.INTERVAL !== '1' ? ` · интервал ${values.INTERVAL}` : '');
}

function recurrence(rule: string | null, anchor: string | null, timezone: string, excluded = new Set<string>()): Recurrence | null {
  if (!rule) return null;
  if (!anchor) return invalid('Для повторения нужна дата начала или срок.');
  if (new Date(anchor).getUTCMilliseconds()) return invalid('Дата повторения должна быть с точностью до секунды.');
  const next = occurrences(rule, anchor, timezone, Date.now(), Date.UTC(9998, 0, 1), excluded, true)[0] || null;
  return { rrule: rule, timezone, human_text: describeRule(rule), next_occurrence_at: next };
}

function effective(value: string | null, anchor: string, occurrence: string | null, timezone: string): string | null {
  if (!value || !occurrence) return value;
  if (Date.parse(value) === Date.parse(anchor)) return occurrence;
  const delta = wallTime(Date.parse(value), timezone) - wallTime(Date.parse(anchor), timezone);
  const target = instantAt(wallTime(Date.parse(occurrence), timezone) + delta, timezone);
  return new Date(target ?? Date.parse(occurrence) + Date.parse(value) - Date.parse(anchor)).toISOString();
}

function schedule(body: Body, user: User, event: boolean): { start_at: string | null; end: string | null; timezone: string; all_day: boolean; rrule: string | null } {
  const timezone = body.timezone === undefined || body.timezone === null ? user.timezone : textValue(body.timezone, 'Часовой пояс', 100);
  formatter(timezone);
  const start = timestamp(body.start_at, 'Начало', !event);
  const end = timestamp(body[event ? 'end_at' : 'due_at'], event ? 'Окончание' : 'Срок', !event);
  const allDay = booleanValue(body.all_day, false);
  if (start && end && (event ? Date.parse(end) <= Date.parse(start) : Date.parse(end) < Date.parse(start))) invalid('Окончание не может быть раньше начала. Для события выберите ненулевую длительность.');
  if (allDay && [start, end].some(value => value && wallTime(Date.parse(value), timezone) % DAY !== 0)) invalid('Для записи на весь день начало и окончание должны быть в полночь выбранного часового пояса.');
  const rule = normalizedRule(body.rrule);
  if (rule && !(start || end)) invalid('Для повторения нужна дата.');
  return { start_at: start, end, timezone, all_day: allDay, rrule: rule };
}

function reminders(value: unknown, anchor: string | null): Reminder[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return invalid('Можно добавить до 10 напоминаний.');
  return value.map(raw => {
    const item = bodyOf(raw);
    onlyFields(item, ['trigger_at', 'offset_minutes', 'channel']);
    if ((item.trigger_at != null) === (item.offset_minutes != null)) invalid('Укажите время напоминания или отступ до события.');
    const offset = item.offset_minutes == null ? null : Number(item.offset_minutes);
    if (offset !== null && (!Number.isInteger(offset) || offset < 0 || offset > 525600 || !anchor)) invalid('Для напоминания задайте дату и корректный отступ.');
    const channel = item.channel ?? 'push';
    if (channel !== 'push' && channel !== 'email') invalid('Выберите способ напоминания.');
    return { id: id(), trigger_at: timestamp(item.trigger_at, 'Напоминание'), offset_minutes: offset, channel, delivered_at: null } as Reminder;
  });
}

function taskDraft(body: Body, user: User, previous?: Task): Task {
  const merged: Body = { ...previous, rrule: previous?.recurrence?.rrule || null, ...body };
  const dates = schedule(merged, user, false);
  const priority = merged.priority ?? 'none';
  if (!['none', 'low', 'medium', 'high'].includes(String(priority))) invalid('Выберите приоритет задачи.');
  const rec = recurrence(dates.rrule, dates.start_at || dates.end, dates.timezone);
  return {
    id: previous?.id || id(), title: textValue(merged.title, 'Название'), notes: optionalText(merged.notes),
    start_at: dates.start_at, due_at: dates.end, timezone: dates.timezone, all_day: dates.all_day,
    priority: priority as Task['priority'], recurrence: rec, completed: rec ? false : previous?.completed || false,
    next_occurrence_at: rec?.next_occurrence_at || null,
    reminders: body.reminders === undefined && previous ? previous.reminders : reminders(body.reminders, dates.end || dates.start_at),
    version: previous ? previous.version + 1 : 1, created_at: previous?.created_at || now(), updated_at: now(),
  };
}

function eventDraft(body: Body, user: User, previous?: CalendarEvent): CalendarEvent {
  const merged: Body = { ...previous, rrule: previous?.recurrence?.rrule || null, ...body };
  const dates = schedule(merged, user, true);
  if (body.reminders !== undefined) reminders(body.reminders, dates.start_at);
  return {
    id: previous?.id || id(), title: textValue(merged.title, 'Название'), notes: optionalText(merged.notes),
    start_at: dates.start_at!, end_at: dates.end!, timezone: dates.timezone, all_day: dates.all_day,
    recurrence: recurrence(dates.rrule, dates.start_at, dates.timezone),
    source: previous?.source || 'local', connection_id: previous?.connection_id || null,
    external_read_only: previous?.external_read_only || false,
    version: previous ? previous.version + 1 : 1, created_at: previous?.created_at || now(), updated_at: now(), occurrence_at: null,
  };
}

function makeList(name: string, system = false): PlanningList {
  return { id: id(), name, kind: system ? 'shopping' : 'custom', is_system: system, is_editable: true, item_count: 0, completed_count: 0, version: 1, created_at: now(), updated_at: now() };
}

function itemDraft(listId: string, body: Body, position: number, previous?: ListItem): ListItem {
  const merged: Body = { ...previous, ...body };
  const quantity = merged.quantity == null ? null : Number(merged.quantity);
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e10 || Math.abs(quantity * 10000 - Math.round(quantity * 10000)) > 1e-4)) invalid('Количество должно быть положительным числом, не больше четырёх знаков после запятой.');
  const order = merged.position == null ? position : Number(merged.position);
  if (!Number.isInteger(order) || order < 0 || order > 2147483647) invalid('Некорректный порядок пункта.');
  return {
    id: previous?.id || id(), list_id: listId, title: textValue(merged.title, 'Название'), quantity: quantity === null ? null : String(quantity),
    unit: merged.unit == null ? null : textValue(merged.unit, 'Единица измерения', 40),
    checked: booleanValue(merged.checked, false), position: order,
    version: previous ? previous.version + 1 : 1, created_at: previous?.created_at || now(), updated_at: now(),
  };
}

function seed(): DemoState {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const user: User = { id: '00000000-0000-4000-8000-000000000001', name: 'Алекс', email: 'demo@lifehub.local', email_verified: true, auth_providers: [], plan: 'pro', trial_ends: null, onboarding_completed: true, free_modules: ['planning'], timezone };
  const at = (day: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + day);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const tasks = [
    taskDraft({ title: 'Подготовить план на следующую неделю', due_at: at(0, 13), priority: 'high', notes: 'Выбрать три главных результата и оставить время на отдых.' }, user),
    taskDraft({ title: 'Забрать заказ из пункта выдачи', due_at: at(0, 19), priority: 'medium', notes: 'Пункт работает до 21:00.' }, user),
    taskDraft({ title: 'Прочитать 20 страниц', due_at: at(-3, 21), rrule: 'FREQ=DAILY', priority: 'low' }, user),
    taskDraft({ title: 'Записаться к стоматологу', priority: 'none' }, user),
    taskDraft({ title: 'Отправить документы', due_at: at(0, 9), priority: 'none' }, user),
    taskDraft({ title: 'Собрать идеи для выходных', due_at: at(1, 18), priority: 'low' }, user),
    taskDraft({ title: 'Разобрать заметки после встречи', due_at: at(-1, 18), priority: 'medium' }, user),
  ];
  tasks[4].completed = true;
  const events = [
    eventDraft({ title: 'Встреча с командой', start_at: at(0, 10), end_at: at(0, 10, 45), notes: 'Обсудить приоритеты и договориться о следующих шагах.' }, user),
    eventDraft({ title: 'Время для себя', start_at: at(0, 13, 30), end_at: at(0, 14, 30), notes: 'Обед и прогулка без телефона.' }, user),
    eventDraft({ title: 'Тренировка', start_at: at(0, 18), end_at: at(0, 19), rrule: 'FREQ=WEEKLY;INTERVAL=1' }, user),
    eventDraft({ title: 'Кофе с Машей', start_at: at(1, 11), end_at: at(1, 12) }, user),
    eventDraft({ title: 'Свободный день', start_at: at(2, 0), end_at: at(3, 0), all_day: true }, user),
  ];
  const shopping = makeList('Покупки', true);
  const travel = makeList('Взять в поездку');
  const ideas = makeList('Идеи на выходные');
  const items = [
    itemDraft(shopping.id, { title: 'Авокадо', quantity: 2, unit: 'шт.' }, 1),
    itemDraft(shopping.id, { title: 'Греческий йогурт', quantity: 2, unit: 'шт.' }, 2),
    itemDraft(shopping.id, { title: 'Помидоры', quantity: 500, unit: 'г' }, 3),
    itemDraft(shopping.id, { title: 'Овсяное молоко', quantity: 1, unit: 'л', checked: true }, 4),
    itemDraft(shopping.id, { title: 'Хлеб на закваске', checked: true }, 5),
    itemDraft(travel.id, { title: 'Документы и билеты' }, 1),
    itemDraft(travel.id, { title: 'Зарядное устройство' }, 2),
    itemDraft(travel.id, { title: 'Книга в дорогу', checked: true }, 3),
    itemDraft(ideas.id, { title: 'Новая выставка в музее' }, 1),
    itemDraft(ideas.id, { title: 'Позавтракать в любимой кофейне' }, 2),
  ];
  return { schema: 1, user, tasks, events, lists: [shopping, travel, ideas], items, completions: { [tasks[4].id]: { once: now() } }, cancellations: {} };
}

function save(value: DemoState): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); }
  catch { fail(507, 'demo_storage', 'Не удалось сохранить демоданные в браузере. Разрешите хранение данных или освободите место.'); }
  memory = value;
}

function state(): DemoState {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.schema === 1 && parsed.user?.id && Array.isArray(parsed.tasks) && Array.isArray(parsed.events) && Array.isArray(parsed.lists) && Array.isArray(parsed.items) && parsed.completions && parsed.cancellations) memory = parsed;
    }
  } catch { /* A malformed previous demo does not affect the real account. */ }
  if (!memory) save(seed());
  return memory!;
}

export function createDemoSession(): AuthSession {
  return {
    user: copy(state().user), demo: true, is_new_user: false,
    tokens: { access_token: 'demo-no-server-access', refresh_token: 'demo-no-server-refresh', token_type: 'bearer', expires_in: 86400, refresh_expires_in: 86400 },
  };
}

function taskResponse(task: Task, data: DemoState): Task {
  const rec = recurrence(task.recurrence?.rrule || null, task.start_at || task.due_at, task.timezone, new Set(Object.keys(data.completions[task.id] || {})));
  return { ...task, recurrence: rec, next_occurrence_at: rec?.next_occurrence_at || null };
}

function eventResponse(event: CalendarEvent, data: DemoState, occurrence: string | null = null): CalendarEvent {
  return { ...event,
    start_at: occurrence || event.start_at,
    end_at: effective(event.end_at, event.start_at, occurrence, event.timezone)!,
    recurrence: recurrence(event.recurrence?.rrule || null, event.start_at, event.timezone, new Set(data.cancellations[event.id] || [])),
    occurrence_at: occurrence,
  };
}

function taskOccurrence(task: Task, data: DemoState, occurrence: string | null): TaskOccurrence {
  const completed = data.completions[task.id]?.[occurrence || 'once'] || null;
  const anchor = task.start_at || task.due_at || now();
  return { task_id: task.id, occurrence_at: occurrence, status: completed ? 'completed' : 'pending', completed_at: completed,
    effective_start_at: effective(task.start_at, anchor, occurrence, task.timezone), effective_due_at: effective(task.due_at, anchor, occurrence, task.timezone) };
}

function listResponse(list: PlanningList, data: DemoState): PlanningList {
  const items = data.items.filter(item => item.list_id === list.id);
  return { ...list, item_count: items.length, completed_count: items.filter(item => item.checked).length };
}

function page<T>(items: T[], params: URLSearchParams): { items: T[]; next_cursor: string | null; total: number } {
  const limit = Number(params.get('limit') || 50);
  const cursor = Number(params.get('cursor') || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(cursor) || cursor < 0) invalid('Некорректные параметры страницы.');
  return { items: items.slice(cursor, cursor + limit), next_cursor: cursor + limit < items.length ? String(cursor + limit) : null, total: items.length };
}

function range(data: DemoState, params: URLSearchParams): CalendarRange {
  const from = timestamp(params.get('from'), 'Начало периода', false)!;
  const to = timestamp(params.get('to'), 'Конец периода', false)!;
  const lower = Date.parse(from), upper = Date.parse(to);
  const timezone = params.get('timezone') || 'UTC';
  formatter(timezone);
  if (upper <= lower || upper - lower > 93 * DAY) fail(422, 'invalid_or_large_range', 'Выберите период от 1 до 93 дней.');
  const tasks: TaskOccurrence[] = [], events: CalendarEvent[] = [];
  for (const task of data.tasks) {
    const anchor = task.start_at || task.due_at;
    if (!anchor) continue;
    const duration = Math.abs(Date.parse(task.due_at || anchor) - Date.parse(anchor)) + DAY;
    const dates = task.recurrence ? occurrences(task.recurrence.rrule, anchor, task.timezone, lower - duration, upper) : [null];
    for (const date of dates) {
      const occurrence = taskOccurrence(task, data, date);
      const start = Date.parse(occurrence.effective_start_at || occurrence.effective_due_at!);
      const end = Date.parse(occurrence.effective_due_at || occurrence.effective_start_at!);
      if (start < upper && (end > lower || start === end && end >= lower)) tasks.push(occurrence);
    }
  }
  for (const event of data.events) {
    const duration = Date.parse(event.end_at) - Date.parse(event.start_at) + DAY;
    const dates = event.recurrence ? occurrences(event.recurrence.rrule, event.start_at, event.timezone, lower - duration, upper, new Set(data.cancellations[event.id] || [])) : [null];
    for (const date of dates) {
      const occurrence = eventResponse(event, data, date);
      if (Date.parse(occurrence.start_at) < upper && Date.parse(occurrence.end_at) > lower) events.push(occurrence);
    }
  }
  if (tasks.length + events.length > 5000) fail(422, 'invalid_or_large_range', 'Слишком много записей в выбранном периоде.');
  tasks.sort((a, b) => Date.parse(a.effective_start_at || a.effective_due_at!) - Date.parse(b.effective_start_at || b.effective_due_at!));
  events.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return { from, to, timezone, tasks, events };
}

const taskFields = ['title', 'notes', 'start_at', 'due_at', 'timezone', 'all_day', 'priority', 'rrule', 'reminders'];
const eventFields = ['title', 'notes', 'start_at', 'end_at', 'timezone', 'all_day', 'rrule', 'reminders'];
const itemFields = ['title', 'quantity', 'unit', 'checked', 'position'];

function route(data: DemoState, path: string, method: string, body: Body, params: URLSearchParams): unknown {
  if (path === '/users/me') {
    if (method === 'GET') return data.user;
    if (method === 'PATCH') {
      onlyFields(body, ['name', 'timezone', 'free_modules', 'onboarding_completed', 'plan']);
      if (body.name !== undefined) data.user.name = textValue(body.name, 'Имя', 50);
      if (body.timezone !== undefined) { const zone = textValue(body.timezone, 'Часовой пояс', 100); formatter(zone); data.user.timezone = zone; }
      if (body.plan !== undefined) fail(403, 'demo_unavailable', 'В деморежиме уже доступны возможности планирования Pro. Настоящий тариф здесь не меняется.');
      if (body.free_modules !== undefined && JSON.stringify(body.free_modules) !== '["planning"]') invalid('Сейчас доступно только планирование.');
      if (body.onboarding_completed === false) fail(409, 'onboarding_already_completed', 'Начальная настройка уже завершена.');
      return data.user;
    }
  }
  if (path === '/auth/logout' && method === 'POST') return undefined;
  if (path.startsWith('/auth/') || path.startsWith('/ai/') || path.includes('/calendar-connections')) {
    if (path === '/planning/calendar-connections' && method === 'GET') return { items: [] };
    fail(503, 'demo_unavailable', 'В деморежиме почта, вход через сервисы, внешние календари и ИИ не подключаются. Войдите в настоящий аккаунт для этой возможности.');
  }
  if (path === '/planning/calendar' && method === 'GET') return range(data, params);
  if (path === '/planning/tasks') {
    if (method === 'GET') {
      let items = [...data.tasks];
      if (params.has('completed')) items = items.filter(item => item.completed === (params.get('completed') === 'true'));
      if (params.has('priority')) items = items.filter(item => item.priority === params.get('priority'));
      if (params.has('from')) { const from = Date.parse(timestamp(params.get('from'), 'Начало периода', false)!); items = items.filter(item => [item.start_at, item.due_at].some(value => value && Date.parse(value) >= from)); }
      if (params.has('to')) { const to = Date.parse(timestamp(params.get('to'), 'Конец периода', false)!); items = items.filter(item => [item.start_at, item.due_at].some(value => value && Date.parse(value) < to)); }
      return page(items.map(item => taskResponse(item, data)), params);
    }
    if (method === 'POST') { onlyFields(body, taskFields); const item = taskDraft(body, data.user); data.tasks.unshift(item); return taskResponse(item, data); }
  }
  const taskMatch = path.match(/^\/planning\/tasks\/([^/]+)(?:\/(complete|reopen))?$/);
  if (taskMatch) {
    const task = data.tasks.find(item => item.id === taskMatch[1]) || missing();
    if (taskMatch[2] && method === 'POST') {
      onlyFields(body, ['version', 'occurrence_at']);
      checkVersion(task, body.version);
      const occurrence = timestamp(body.occurrence_at, 'Повторение');
      if (task.recurrence) {
        if (!occurrence) return fail(422, 'occurrence_required', 'Выберите конкретное повторение.');
        const instant = Date.parse(occurrence);
        if (!occurrences(task.recurrence.rrule, (task.start_at || task.due_at)!, task.timezone, instant, instant + 1).length) fail(422, 'invalid_occurrence', 'Повторение не найдено.');
      } else if (occurrence) fail(422, 'invalid_occurrence', 'Обычная задача не содержит повторений.');
      const records = data.completions[task.id] ||= {};
      const key = occurrence || 'once';
      const reopen = taskMatch[2] === 'reopen';
      if (Boolean(records[key]) === !reopen) fail(409, reopen ? 'not_completed' : 'already_completed', reopen ? 'Задача уже открыта.' : 'Задача уже завершена.');
      if (reopen) delete records[key]; else records[key] = now();
      if (!task.recurrence) task.completed = !reopen;
      touch(task);
      return taskOccurrence(task, data, occurrence);
    }
    if (!taskMatch[2]) {
      if (method === 'GET') return taskResponse(task, data);
      if (method === 'PATCH') {
        onlyFields(body, [...taskFields, 'version']); checkVersion(task, body.version, true);
        const updated = taskDraft(body, data.user, task);
        if (!task.recurrence && updated.recurrence) delete data.completions[task.id]?.once;
        data.tasks[data.tasks.indexOf(task)] = updated;
        return taskResponse(updated, data);
      }
      if (method === 'DELETE') { checkVersion(task, params.get('version')); data.tasks = data.tasks.filter(item => item !== task); delete data.completions[task.id]; return undefined; }
    }
  }
  if (path === '/planning/events') {
    if (method === 'GET') {
      let items = [...data.events];
      if (params.has('source')) items = items.filter(item => item.source === params.get('source'));
      if (params.has('from')) { const from = Date.parse(timestamp(params.get('from'), 'Начало периода', false)!); items = items.filter(item => item.recurrence || Date.parse(item.end_at) > from); }
      if (params.has('to')) { const to = Date.parse(timestamp(params.get('to'), 'Конец периода', false)!); items = items.filter(item => Date.parse(item.start_at) < to); }
      return page(items.map(item => eventResponse(item, data)), params);
    }
    if (method === 'POST') { onlyFields(body, eventFields); const item = eventDraft(body, data.user); data.events.unshift(item); return eventResponse(item, data); }
  }
  const eventMatch = path.match(/^\/planning\/events\/([^/]+)$/);
  if (eventMatch) {
    const event = data.events.find(item => item.id === eventMatch[1]) || missing();
    if (method === 'GET') return eventResponse(event, data);
    if (event.external_read_only) fail(409, 'sync_conflict', 'Событие доступно только для чтения.');
    if (method === 'PATCH') {
      onlyFields(body, [...eventFields, 'version']); checkVersion(event, body.version, true);
      const updated = eventDraft(body, data.user, event);
      data.events[data.events.indexOf(event)] = updated;
      return eventResponse(updated, data);
    }
    if (method === 'DELETE') {
      checkVersion(event, params.get('version'));
      const scope = params.get('scope') || 'all';
      if (!['this', 'future', 'all'].includes(scope)) invalid('Выберите область удаления.');
      const occurrence = timestamp(params.get('occurrence_at'), 'Повторение');
      if (event.recurrence && scope !== 'all') {
        if (!occurrence) return fail(422, 'occurrence_required', 'Выберите конкретное повторение.');
        const instant = Date.parse(occurrence);
        if (!occurrences(event.recurrence.rrule, event.start_at, event.timezone, instant, instant + 1).length) fail(422, 'invalid_occurrence', 'Повторение не найдено.');
        if (scope === 'this') { const cancelled = data.cancellations[event.id] ||= []; if (!cancelled.includes(occurrence)) cancelled.push(occurrence); }
        else if (instant <= Date.parse(event.start_at)) data.events = data.events.filter(item => item !== event);
        else {
          const parts = Object.fromEntries(event.recurrence.rrule.split(';').map(part => part.split('=')));
          delete parts.COUNT;
          parts.UNTIL = new Date(instant - 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');
          event.recurrence.rrule = Object.entries(parts).map(([key, value]) => `${key}=${value}`).join(';');
        }
        touch(event);
      } else {
        if (!event.recurrence && occurrence) fail(422, 'invalid_occurrence', 'Обычное событие не содержит повторений.');
        data.events = data.events.filter(item => item !== event);
        delete data.cancellations[event.id];
      }
      return undefined;
    }
  }
  if (path === '/planning/lists') {
    if (method === 'GET') return { items: data.lists.map(item => listResponse(item, data)) };
    if (method === 'POST') { onlyFields(body, ['name']); const list = makeList(textValue(body.name, 'Название списка', 100)); data.lists.push(list); return list; }
  }
  const listMatch = path.match(/^\/planning\/lists\/([^/]+)(?:\/items(?:\/([^/]+))?)?$/);
  if (listMatch) {
    const list = data.lists.find(item => item.id === listMatch[1]) || missing();
    if (!path.includes('/items')) {
      if (method === 'GET') return listResponse(list, data);
      if (list.is_system) fail(409, 'system_list_locked', 'Список «Покупки» нельзя переименовать или удалить.');
      if (method === 'PATCH') { onlyFields(body, ['name', 'version']); checkVersion(list, body.version); list.name = textValue(body.name, 'Название списка', 100); touch(list); return listResponse(list, data); }
      if (method === 'DELETE') { data.lists = data.lists.filter(item => item !== list); data.items = data.items.filter(item => item.list_id !== list.id); return undefined; }
    } else if (!listMatch[2] || listMatch[2] === 'bulk') {
      if (method === 'GET' && !listMatch[2]) return page(data.items.filter(item => item.list_id === list.id).sort((a, b) => a.position - b.position), params);
      if (method === 'POST') {
        const bulk = listMatch[2] === 'bulk';
        if (bulk) onlyFields(body, ['items']); else onlyFields(body, itemFields);
        const values = bulk ? body.items : [body];
        if (!Array.isArray(values) || !values.length || values.length > 100) return invalid('Добавьте от 1 до 100 пунктов.');
        const position = Math.max(0, ...data.items.filter(item => item.list_id === list.id).map(item => item.position)) + 1;
        const created = values.map((raw, index) => { const draft = bodyOf(raw); onlyFields(draft, itemFields); return itemDraft(list.id, draft, position + index); });
        data.items.push(...created); touch(list);
        return bulk ? { items: created, next_cursor: null, total: created.length } : created[0];
      }
    } else {
      const item = data.items.find(item => item.id === listMatch[2] && item.list_id === list.id) || missing();
      if (method === 'PATCH') {
        onlyFields(body, [...itemFields, 'version']); checkVersion(item, body.version, true);
        const updated = itemDraft(list.id, body, item.position, item);
        data.items[data.items.indexOf(item)] = updated; touch(list); return updated;
      }
      if (method === 'DELETE') { data.items = data.items.filter(value => value !== item); touch(list); return undefined; }
    }
  }
  return fail(404, 'demo_unavailable', 'Это действие недоступно в деморежиме.');
}

export async function demoRequest(path: string, options: ApiOptions, _user: User): Promise<unknown> {
  options.signal?.throwIfAborted();
  const url = new URL(path, 'https://demo.lifehub.invalid');
  const method = options.method || 'GET';
  const data = copy(state());
  const result = route(data, url.pathname, method, options.body === undefined ? {} : bodyOf(options.body), url.searchParams);
  options.signal?.throwIfAborted();
  if (method !== 'GET') save(data);
  return copy(result);
}
