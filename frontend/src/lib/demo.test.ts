import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarRange, ListItem, Page, PlanningList, Task, TaskOccurrence, User } from './types';
import type { ApiOptions } from './api';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

let demo: typeof import('./demo');
let user: User;
let storage: MemoryStorage;
const call = async <T>(path: string, options: ApiOptions = {}) => await demo.demoRequest(path, options, user) as T;
const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body });
const calendar = (from: string, to: string) => call<CalendarRange>(`/planning/calendar?${new URLSearchParams({ from, to, timezone: 'Europe/Warsaw' })}`);

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
  storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage);
  demo = await import('./demo'); user = demo.createDemoSession().user;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('demo tasks and persistence', () => {
  it('seeds relative to today and persists edits across a module reload', async () => {
    const seed = await call<Page<Task>>('/planning/tasks');
    expect(seed.items.some(item => item.due_at?.startsWith('2026-03-27'))).toBe(true);
    const created = await post<Task>('/planning/tasks', { title: 'Моя задача', notes: 'Сохранить локально' });
    vi.resetModules(); demo = await import('./demo');
    expect((await call<Task>(`/planning/tasks/${created.id}`)).title).toBe('Моя задача');
    expect(demo.createDemoSession().demo).toBe(true);
  });

  it('supports task edits, completion, reopening and delete with optimistic versions', async () => {
    const created = await post<Task>('/planning/tasks', { title: 'Позвонить', due_at: '2026-03-28T10:00:00Z' });
    const edited = await call<Task>(`/planning/tasks/${created.id}`, { method: 'PATCH', body: { version: 1, title: 'Позвонить родителям' } });
    expect(edited.version).toBe(2);
    await expect(call(`/planning/tasks/${created.id}`, { method: 'PATCH', body: { version: 1, title: 'Потерянное изменение' } })).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    const completed = await post<TaskOccurrence>(`/planning/tasks/${created.id}/complete`, { version: 2 });
    expect(completed.status).toBe('completed');
    await expect(post(`/planning/tasks/${created.id}/complete`, {})).rejects.toMatchObject({ code: 'already_completed' });
    expect((await call<Task>(`/planning/tasks/${created.id}`)).completed).toBe(true);
    expect((await post<TaskOccurrence>(`/planning/tasks/${created.id}/reopen`, { version: 3 })).status).toBe('pending');
    await expect(call(`/planning/tasks/${created.id}?version=3`, { method: 'DELETE' })).rejects.toMatchObject({ code: 'version_conflict' });
    await call(`/planning/tasks/${created.id}?version=4`, { method: 'DELETE' });
    await expect(call(`/planning/tasks/${created.id}`)).rejects.toMatchObject({ status: 404 });
  });

  it('completes only the selected recurring occurrence and validates its instant', async () => {
    const task = await post<Task>('/planning/tasks', { title: 'Почитать', due_at: '2026-03-28T08:00:00Z', rrule: 'FREQ=DAILY;COUNT=3', timezone: 'Europe/Warsaw' });
    await expect(post(`/planning/tasks/${task.id}/complete`, {})).rejects.toMatchObject({ code: 'occurrence_required' });
    await expect(post(`/planning/tasks/${task.id}/complete`, { occurrence_at: '2026-03-28T09:00:00Z' })).rejects.toMatchObject({ code: 'invalid_occurrence' });
    await post(`/planning/tasks/${task.id}/complete`, { occurrence_at: '2026-03-28T08:00:00Z', version: 1 });
    expect((await call<Task>(`/planning/tasks/${task.id}`)).completed).toBe(false);
    const entries = (await calendar('2026-03-28T00:00:00Z', '2026-03-31T00:00:00Z')).tasks.filter(item => item.task_id === task.id);
    expect(entries.map(item => [item.occurrence_at, item.status])).toEqual([
      ['2026-03-28T08:00:00.000Z', 'completed'], ['2026-03-29T07:00:00.000Z', 'pending'], ['2026-03-30T07:00:00.000Z', 'pending'],
    ]);
    await post(`/planning/tasks/${task.id}/reopen`, { occurrence_at: '2026-03-28T08:00:00Z', version: 2 });
    expect((await calendar('2026-03-28T08:00:00Z', '2026-03-28T08:00:01Z')).tasks.find(item => item.task_id === task.id)?.status).toBe('pending');
  });

  it('rejects invalid dates and recurrence without persisting partial mutations', async () => {
    const before = (await call<Page<Task>>('/planning/tasks')).total;
    await expect(post('/planning/tasks', { title: 'Без даты', rrule: 'FREQ=DAILY' })).rejects.toMatchObject({ status: 422 });
    await expect(post('/planning/tasks', { title: 'Без часового пояса', due_at: '2026-03-28T10:00:00' })).rejects.toMatchObject({ status: 422 });
    await expect(post('/planning/tasks', { title: 'Ошибка', start_at: '2026-03-29T10:00:00Z', due_at: '2026-03-28T10:00:00Z' })).rejects.toMatchObject({ status: 422 });
    expect((await call<Page<Task>>('/planning/tasks')).total).toBe(before);
  });

  it('does not acknowledge a saved mutation if browser storage fails', async () => {
    const before = (await call<Page<Task>>('/planning/tasks')).total;
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await expect(post('/planning/tasks', { title: 'Не сохранилась' })).rejects.toMatchObject({ code: 'demo_storage' });
    spy.mockRestore();
    expect((await call<Page<Task>>('/planning/tasks')).total).toBe(before);
  });
});

describe('calendar semantics', () => {
  it('keeps local event times across DST changes and applies individual/future deletion', async () => {
    const event = await post<CalendarEvent>('/planning/events', { title: 'Утренняя встреча', start_at: '2026-03-28T08:00:00Z', end_at: '2026-03-28T09:00:00Z', timezone: 'Europe/Warsaw', rrule: 'FREQ=DAILY;COUNT=5' });
    const entries = (await calendar('2026-03-28T00:00:00Z', '2026-04-02T00:00:00Z')).events.filter(item => item.id === event.id);
    expect(entries.slice(0, 2).map(item => [item.start_at, item.end_at])).toEqual([
      ['2026-03-28T08:00:00.000Z', '2026-03-28T09:00:00.000Z'],
      ['2026-03-29T07:00:00.000Z', '2026-03-29T08:00:00.000Z'],
    ]);
    await call(`/planning/events/${event.id}?${new URLSearchParams({ scope: 'this', occurrence_at: '2026-03-29T07:00:00Z', version: '1' })}`, { method: 'DELETE' });
    const afterOne = (await calendar('2026-03-28T00:00:00Z', '2026-04-02T00:00:00Z')).events.filter(item => item.id === event.id);
    expect(afterOne).toHaveLength(4);
    expect(afterOne.some(item => item.start_at === '2026-03-29T07:00:00.000Z')).toBe(false);
    await call(`/planning/events/${event.id}?${new URLSearchParams({ scope: 'future', occurrence_at: '2026-03-31T07:00:00Z', version: '2' })}`, { method: 'DELETE' });
    const afterFuture = (await calendar('2026-03-28T00:00:00Z', '2026-04-02T00:00:00Z')).events.filter(item => item.id === event.id);
    expect(afterFuture.map(item => item.start_at)).toEqual(['2026-03-28T08:00:00.000Z', '2026-03-30T07:00:00.000Z']);
    await call(`/planning/events/${event.id}?scope=all&version=3`, { method: 'DELETE' });
    await expect(call(`/planning/events/${event.id}`)).rejects.toMatchObject({ status: 404 });
  });

  it('skips nonexistent local times without consuming the recurrence count', async () => {
    const event = await post<CalendarEvent>('/planning/events', { title: 'Ночная запись', start_at: '2026-03-28T01:30:00Z', end_at: '2026-03-28T02:00:00Z', timezone: 'Europe/Warsaw', rrule: 'FREQ=DAILY;COUNT=2' });
    const entries = (await calendar('2026-03-28T00:00:00Z', '2026-03-31T00:00:00Z')).events.filter(item => item.id === event.id);
    expect(entries.map(item => item.start_at)).toEqual(['2026-03-28T01:30:00.000Z', '2026-03-30T00:30:00.000Z']);
  });

  it('treats all-day end dates and calendar upper boundaries as exclusive', async () => {
    const event = await post<CalendarEvent>('/planning/events', { title: 'Выходной', start_at: '2026-03-27T23:00:00Z', end_at: '2026-03-28T23:00:00Z', timezone: 'Europe/Warsaw', all_day: true });
    expect((await calendar('2026-03-27T23:00:00Z', '2026-03-28T23:00:00Z')).events.some(item => item.id === event.id)).toBe(true);
    expect((await calendar('2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z')).events.some(item => item.id === event.id)).toBe(false);
    expect((await calendar('2026-03-26T23:00:00Z', '2026-03-27T23:00:00Z')).events.some(item => item.id === event.id)).toBe(false);
    await expect(post('/planning/events', { title: 'Неверный день', start_at: '2026-03-28T10:00:00Z', end_at: '2026-03-28T11:00:00Z', timezone: 'Europe/Warsaw', all_day: true })).rejects.toMatchObject({ status: 422 });
  });

  it('includes overlapping events and excludes undated tasks from the calendar', async () => {
    const task = await post<Task>('/planning/tasks', { title: 'Когда-нибудь' });
    const event = await post<CalendarEvent>('/planning/events', { title: 'Длинная встреча', start_at: '2026-03-28T08:00:00Z', end_at: '2026-03-28T12:00:00Z' });
    const result = await calendar('2026-03-28T10:00:00Z', '2026-03-28T11:00:00Z');
    expect(result.events.some(item => item.id === event.id)).toBe(true);
    expect(result.tasks.some(item => item.task_id === task.id)).toBe(false);
    await expect(calendar('2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z')).rejects.toMatchObject({ code: 'invalid_or_large_range' });
  });
});

describe('lists and local profile', () => {
  it('locks the shopping list itself while allowing its items to change', async () => {
    const lists = await call<{ items: PlanningList[] }>('/planning/lists');
    const shopping = lists.items.find(item => item.is_system)!;
    await expect(call(`/planning/lists/${shopping.id}`, { method: 'DELETE' })).rejects.toMatchObject({ code: 'system_list_locked' });
    await expect(call(`/planning/lists/${shopping.id}`, { method: 'PATCH', body: { name: 'Другое имя' } })).rejects.toMatchObject({ code: 'system_list_locked' });
    const item = await post<ListItem>(`/planning/lists/${shopping.id}/items`, { title: 'Кофе', quantity: 0.25, unit: 'кг' });
    expect(item.quantity).toBe('0.25');
    await call(`/planning/lists/${shopping.id}/items/${item.id}`, { method: 'PATCH', body: { version: 1, checked: true } });
    const updated = await call<PlanningList>(`/planning/lists/${shopping.id}`);
    expect(updated.item_count).toBe(shopping.item_count + 1);
    expect(updated.completed_count).toBe(shopping.completed_count + 1);
  });

  it('supports paginated list items and atomic bulk additions', async () => {
    const list = await post<PlanningList>('/planning/lists', { name: 'Сборы' });
    await post(`/planning/lists/${list.id}/items/bulk`, { items: [{ title: 'Первый' }, { title: 'Второй' }, { title: 'Третий' }] });
    const first = await call<Page<ListItem>>(`/planning/lists/${list.id}/items?limit=2`);
    expect(first.total).toBe(3); expect(first.items.map(item => item.title)).toEqual(['Первый', 'Второй']);
    const last = await call<Page<ListItem>>(`/planning/lists/${list.id}/items?limit=2&cursor=${first.next_cursor}`);
    expect(last.items.map(item => item.title)).toEqual(['Третий']); expect(last.next_cursor).toBeNull();
    await expect(post(`/planning/lists/${list.id}/items/bulk`, { items: [{ title: 'Не должен сохраниться' }, { title: 'Ошибка', quantity: -1 }] })).rejects.toMatchObject({ status: 422 });
    expect((await call<Page<ListItem>>(`/planning/lists/${list.id}/items`)).total).toBe(3);
    await call(`/planning/lists/${list.id}`, { method: 'DELETE' });
    await expect(call(`/planning/lists/${list.id}/items`)).rejects.toMatchObject({ status: 404 });
  });

  it('protects item parent relationships and optimistic versions', async () => {
    const first = await post<PlanningList>('/planning/lists', { name: 'Один' });
    const second = await post<PlanningList>('/planning/lists', { name: 'Два' });
    const item = await post<ListItem>(`/planning/lists/${first.id}/items`, { title: 'Вещь' });
    await expect(call(`/planning/lists/${second.id}/items/${item.id}`, { method: 'DELETE' })).rejects.toMatchObject({ status: 404 });
    await call(`/planning/lists/${first.id}/items/${item.id}`, { method: 'PATCH', body: { version: 1, checked: true } });
    await expect(call(`/planning/lists/${first.id}/items/${item.id}`, { method: 'PATCH', body: { version: 1, title: 'Старая версия' } })).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('changes only the local demo profile and rejects fake email or AI actions', async () => {
    const updated = await call<User>('/users/me', { method: 'PATCH', body: { name: 'Мария', timezone: 'Europe/Paris' } });
    expect(updated.name).toBe('Мария'); expect(demo.createDemoSession().user.timezone).toBe('Europe/Paris');
    await expect(post('/auth/forgot-password', { email: 'example@example.com' })).rejects.toMatchObject({ code: 'demo_unavailable' });
    await expect(post('/ai/chat', { message: 'Купить молоко' })).rejects.toMatchObject({ code: 'demo_unavailable' });
    await expect(post('/planning/calendar-connections/google/start', {})).rejects.toMatchObject({ code: 'demo_unavailable' });
    expect(await call('/planning/calendar-connections')).toEqual({ items: [] });
  });
});
