import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { dateKey, dayLabel, minutesOfDay, parts, shiftDay, todayKey, weekDays, zonedISO } from '../lib/dates';
import type { CalendarEvent, CalendarRange, Task, TaskOccurrence } from '../lib/types';

interface Block { id: string; title: string; start: number; end: number; kind: 'task' | 'event'; event?: CalendarEvent; task?: Task; occurrence?: TaskOccurrence; completed?: boolean; point?: boolean; offset?: string; color: number }

/** Events and interval tasks occupy [start, end); single-time tasks are points. */
export function intervalOccupiesDay(startAt: string, endAt: string, day: string, timezone: string) {
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  if (start === end) return dateKey(startAt, timezone) === day;
  return dateKey(startAt, timezone) <= day && dateKey(new Date(end - 1), timezone) >= day;
}

export function eventOccupiesDay(event: CalendarEvent, day: string, timezone: string) {
  return intervalOccupiesDay(event.start_at, event.end_at, day, event.all_day ? event.timezone : timezone);
}

export function taskOccupiesDay(task: Task, occurrence: TaskOccurrence, day: string, timezone: string) {
  const start = occurrence.effective_start_at || occurrence.effective_due_at;
  const end = occurrence.effective_due_at || start;
  return !!start && !!end && intervalOccupiesDay(start, end, day, task.all_day ? task.timezone : timezone);
}

function minutePosition(value: string, timezone: string) {
  const local = parts(value, timezone);
  return Number(local.hour) * 60 + Number(local.minute) + Number(local.second) / 60;
}

function offsetSeconds(at: number, timezone: string) {
  const wholeSecond = Math.floor(at / 1000) * 1000;
  const local = parts(new Date(wholeSecond), timezone);
  return (Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second) - wholeSecond) / 1000;
}

function offsetLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' })
    .formatToParts(at).find(part => part.type === 'timeZoneName')?.value || timezone;
}

function clipInterval(startAt: string, endAt: string, timezone: string, dayStart: number, dayEnd: number) {
  const point = Date.parse(startAt) === Date.parse(endAt);
  if (point) {
    const start = minutePosition(startAt, timezone);
    return [{ start, end: Math.min(1440, start + 30), point }];
  }
  const from = Math.max(dayStart, Date.parse(startAt)), to = Math.min(dayEnd, Date.parse(endAt));
  if (to <= from) return [];
  const segments = [{ from, to }];
  const firstOffset = offsetSeconds(from, timezone);
  if (firstOffset !== offsetSeconds(to - 1, timezone)) {
    // A 24-hour wall-clock grid contains a gap in spring and a repeated hour
    // in autumn. Split at the transition rather than giving a block a negative
    // duration or occupying a nonexistent local hour.
    let low = Math.floor(from / 1000), high = Math.floor((to - 1) / 1000);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsetSeconds(middle * 1000, timezone) === firstOffset) low = middle + 1;
      else high = middle;
    }
    const transition = low * 1000;
    segments.splice(0, 1, { from, to: transition }, { from: transition, to });
  }
  return segments.filter(segment => segment.to > segment.from).map(segment => {
    const start = minutePosition(new Date(segment.from).toISOString(), timezone);
    return { start, end: Math.min(1440, start + (segment.to - segment.from) / 60_000), point,
      offset: segments.length > 1 ? offsetLabel(new Date(segment.from), timezone) : undefined };
  });
}

export function calendarOffsetLabel(day: string, timezone: string) {
  // Local noon avoids a midnight transition and uses the date being viewed.
  const at = new Date(zonedISO(day, '12:00', timezone));
  return offsetLabel(at, timezone);
}

export function calendarWeekLabel(first: string, last: string) {
  if (first.slice(0, 4) !== last.slice(0, 4)) {
    const fullDate: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    return `${dayLabel(first, fullDate)} — ${dayLabel(last, fullDate)}`;
  }
  const firstOptions: Intl.DateTimeFormatOptions = first.slice(0, 7) === last.slice(0, 7) ? { day: 'numeric' } : { day: 'numeric', month: 'long' };
  return `${dayLabel(first, firstOptions)} — ${dayLabel(last)}`;
}

function blockTime(minutes: number) {
  const rounded = Math.max(0, Math.min(1440, Math.floor(minutes)));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

function blockLabel(block: Block) {
  const times = block.point ? blockTime(block.start) : `${blockTime(block.start)} — ${blockTime(block.end)}`;
  return block.offset ? `${times} (${block.offset})` : times;
}

export function calendarDayBlocks(day: string, timezone: string, calendar: CalendarRange | null, tasks: Task[]): Block[] {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const dayStart = Date.parse(zonedISO(day, '00:00', timezone)), dayEnd = Date.parse(zonedISO(shiftDay(day, 1), '00:00', timezone));
  const events: Block[] = (calendar?.events || []).filter(event => !event.all_day && eventOccupiesDay(event, day, timezone)).flatMap(event => clipInterval(event.start_at, event.end_at, timezone, dayStart, dayEnd).map((segment, index) => ({
    id: `${event.id}:${event.occurrence_at}:${index}`, title: event.title,
    ...segment, kind: 'event' as const, event,
    color: Array.from(event.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3,
  })));
  const timedTasks: Block[] = [];
  for (const occurrence of calendar?.tasks || []) {
    const task = tasksById.get(occurrence.task_id);
    if (!task || task.all_day || !taskOccupiesDay(task, occurrence, day, timezone)) continue;
    const start = occurrence.effective_start_at || occurrence.effective_due_at!;
    const end = occurrence.effective_due_at || start;
    timedTasks.push(...clipInterval(start, end, timezone, dayStart, dayEnd).map((segment, index) => ({ id: `${task.id}:${occurrence.occurrence_at}:${index}`, title: task.title,
      ...segment, kind: 'task' as const, task, occurrence,
      completed: occurrence.status === 'completed', color: 3 })));
  }
  return [...events, ...timedTasks];
}
export function layoutBlocks<T extends { start: number; end: number }>(blocks: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end), result: (T & { lane: number; lanes: number })[] = [];
  let group: T[] = [], groupEnd = -1;
  function flush() { const ends: number[] = []; const laid = group.map(block => { let lane = ends.findIndex(end => end <= block.start); if (lane < 0) lane = ends.length; ends[lane] = block.end; return { ...block, lane }; }); result.push(...laid.map(block => ({ ...block, lanes: ends.length }))); group = []; }
  for (const block of sorted) { if (group.length && block.start >= groupEnd) flush(); group.push(block); groupEnd = group.length === 1 ? block.end : Math.max(groupEnd, block.end); }
  if (group.length) flush(); return result;
}
export function CalendarView({ selected, onSelect, timezone, calendar, tasks, onEvent, onTask, onCreate }: {
  selected: string; onSelect: (day: string) => void; timezone: string; calendar: CalendarRange | null; tasks: Task[];
  onEvent: (event: CalendarEvent) => void; onTask: (task: Task, occurrence?: TaskOccurrence) => void;
  onCreate: (day: string, time?: string) => void;
}) {
  const [view, setView] = useState<'day' | 'week'>(() => window.innerWidth < 800 ? 'day' : 'week');
  const scroll = useRef<HTMLDivElement>(null);
  const days = view === 'day' ? [selected] : weekDays(selected), today = todayKey(timezone);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7.5 * 60; }, []);
  const getEvents = (day: string) => (calendar?.events || []).filter(event => eventOccupiesDay(event, day, timezone));
  const getTasks = (day: string) => (calendar?.tasks || []).map(occurrence => ({ occurrence, task: tasks.find(task => task.id === occurrence.task_id) }))
    .filter((item): item is { occurrence: TaskOccurrence; task: Task } => Boolean(item.task) && taskOccupiesDay(item.task!, item.occurrence, day, timezone));
  return <section className="calendar-panel panel"><header className="calendar-toolbar"><div className="calendar-range"><button className="icon-button" aria-label={view === 'week' ? 'Предыдущая неделя' : 'Предыдущий день'} onClick={() => onSelect(shiftDay(selected, view === 'week' ? -7 : -1))}><ChevronLeft size={19} /></button><button className="icon-button" aria-label={view === 'week' ? 'Следующая неделя' : 'Следующий день'} onClick={() => onSelect(shiftDay(selected, view === 'week' ? 7 : 1))}><ChevronRight size={19} /></button><h2>{view === 'week' ? calendarWeekLabel(days[0], days[6]) : dayLabel(selected, { day: 'numeric', month: 'long' })}</h2><button className="button secondary small" onClick={() => onSelect(today)}>Сегодня</button></div><div className="segmented" role="group" aria-label="Вид календаря"><button className={view === 'day' ? 'selected' : ''} aria-pressed={view === 'day'} onClick={() => setView('day')}>День</button><button className={view === 'week' ? 'selected' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Неделя</button></div></header>
    <div className={`calendar-overflow ${view}`}><div className="calendar-inner"><div className="calendar-day-heads" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(0,1fr))` }}><span className="timezone-abbr" title={timezone}>{calendarOffsetLabel(selected, timezone)}</span>{days.map(day => <button className={`day-head ${day === today ? 'is-today' : ''}`} key={day} onClick={() => onSelect(day)} aria-label={`Выбрать ${dayLabel(day)}`}><span>{dayLabel(day, { weekday: 'short' })}</span><strong>{Number(day.slice(-2))}</strong></button>)}</div>
      <div className="all-day-grid" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(0,1fr))` }}><span className="all-day-label">Весь<br />день</span>{days.map(day => <div className="all-day-cell" key={day}>{getEvents(day).filter(e => e.all_day).map(event => <button className="all-day-event" key={`${event.id}:${event.occurrence_at}`} onClick={() => onEvent(event)}>{event.title}</button>)}{getTasks(day).filter(({ task }) => task.all_day).map(({ task, occurrence }) => <button className={`all-day-task ${occurrence.status === 'completed' ? 'done' : ''}`} key={`${task.id}:${occurrence.occurrence_at}`} onClick={() => onTask(task, occurrence)}>{task.title}</button>)}</div>)}</div>
      <div className="calendar-scroll" ref={scroll}><div className="calendar-time-grid" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(0,1fr))` }}><div className="hour-axis">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * 60 }}>{String(h).padStart(2, '0')}:00</span>)}</div>{days.map(day => <div className="calendar-day-column" key={day}>{Array.from({ length: 24 }, (_, h) => <button className="hour-slot" key={h} aria-label={`Создать событие ${dayLabel(day)} в ${h}:00`} style={{ top: h * 60 }} onClick={() => onCreate(day, `${String(h).padStart(2, '0')}:00`)}><Plus size={13} /></button>)}{layoutBlocks(calendarDayBlocks(day, timezone, calendar, tasks)).map(block => <button key={block.id} className={`calendar-block block-${block.color} ${block.completed ? 'done' : ''}`} style={{ top: block.start, height: Math.max(1, block.end - block.start - (block.end - block.start > 6 ? 3 : 0)), padding: block.end - block.start < 24 ? '0 4px' : undefined, boxSizing: 'border-box', left: `calc(${block.lane / block.lanes * 100}% + 4px)`, width: `calc(${100 / block.lanes}% - 8px)` }} onClick={() => block.event ? onEvent(block.event) : onTask(block.task!, block.occurrence)} title={`${block.title} · ${dayLabel(day)} · ${blockLabel(block)}`} aria-label={`${block.title}, ${dayLabel(day)}, ${blockLabel(block)}`}><strong>{block.title}</strong>{block.end - block.start > 38 && <span>{blockLabel(block)}{block.kind === 'task' ? ' · Задача' : ''}</span>}{block.event?.notes && block.end - block.start > 70 && <p>{block.event.notes}</p>}</button>)}{day === today && <div className="current-time-line" style={{ top: minutesOfDay(new Date().toISOString(), timezone) }}><i /></div>}</div>)}</div></div>
    </div></div><footer className="calendar-legend"><span><i className="green" />События</span><span><i className="gold" />Задачи</span><span className="calendar-hint"><CalendarDays size={13} />Нажмите на свободное время, чтобы добавить событие</span></footer>
  </section>;
}
