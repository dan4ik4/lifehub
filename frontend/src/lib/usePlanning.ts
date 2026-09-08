import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { shiftDay, startOfDay } from './dates';
import type { CalendarRange, Page, PlanningList, Task } from './types';

export async function allPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  let cursor: string | null | undefined = null;
  const items: T[] = [], seen = new Set<string>();
  do {
    const separator = path.includes('?') ? '&' : '?';
    const page: Page<T> = await api<Page<T>>(`${path}${separator}limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { signal });
    items.push(...page.items); cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Не удалось загрузить следующую страницу. Обновите данные.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
export function usePlanning(timezone: string, from: string, to: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<PlanningList[]>([]);
  const [calendar, setCalendar] = useState<CalendarRange | null>(null);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), initialized = useRef(false);
  const parameters = useRef({ timezone, from, to });
  parameters.current = { timezone, from, to };
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    const requested = parameters.current;
    const isCurrent = () => !current.signal.aborted && requested.timezone === parameters.current.timezone && requested.from === parameters.current.from && requested.to === parameters.current.to;
    initialized.current ? setRefreshing(true) : setLoading(true);
    try {
      const { timezone, from, to } = requested;
      // Floating all-day dates can be in a timezone up to 26 hours from the viewer.
      const query = new URLSearchParams({ from: startOfDay(shiftDay(from, -2), timezone), to: startOfDay(shiftDay(to, 2), timezone), timezone });
      const [newTasks, newLists, newCalendar] = await Promise.all([
        allPages<Task>('/planning/tasks', current.signal),
        api<Page<PlanningList>>('/planning/lists', { signal: current.signal }),
        api<CalendarRange>('/planning/calendar?' + query, { signal: current.signal }),
      ]);
      if (!isCurrent()) return;
      setTasks(newTasks); setLists(newLists.items); setCalendar(newCalendar); setError(''); initialized.current = true;
    } catch (error) { if (isCurrent()) setError(errorMessage(error)); }
    finally { if (isCurrent()) { setLoading(false); setRefreshing(false); } }
  }, []);
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [refresh, timezone, from, to]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    return () => { document.removeEventListener('visibilitychange', refreshWhenVisible); clearInterval(timer); };
  }, [refresh]);
  return { tasks, lists, calendar, loading, refreshing, error, refresh };
}
