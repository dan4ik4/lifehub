import { t } from '../lib/language';
import {LifeCard,LifeLink,LifeRings} from './LifeCard';
import {availableWindows,busyIntervals} from './FreeTime';
import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, Coffee, Plus, Sparkles, Sun } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { dateKey, dayLabel, plural, shiftDay, startOfDay, zonedISO, timeText, todayKey, weekDays } from '../lib/dates';
import type { CalendarEvent, CalendarRange, Notify, Task, TaskOccurrence, User } from '../lib/types';

import { EmptyState } from './ui';
import { MiniCalendar } from './MiniCalendar';
import { TaskRow } from './TaskRow';

interface Props {
  user: User; selected: string; onSelect: (day: string) => void; tasks: Task[]; calendar: CalendarRange | null;
  busyIds: string[]; onToggle: (task: Task, occurrence?: TaskOccurrence) => void;
  onEdit: (task: Task) => void; onDelete: (task: Task) => void; onCreate: () => void;
  onCreateEvent: () => void; onEvent: (event: CalendarEvent) => void; onCalendar: () => void; onFree:()=>void;
  refresh: () => Promise<void>; notify: Notify;
}

export function TodayView({ user, selected, onSelect, tasks, calendar, busyIds, onToggle, onEdit, onDelete, onCreate, onCreateEvent, onEvent, onCalendar, onFree, refresh, notify }: Props) {
  const [filter, setFilter] = useState<'day' | 'upcoming' | 'all' | 'done'>('day'), [showDone, setShowDone] = useState(false), [quickTitle, setQuickTitle] = useState(''), [adding, setAdding] = useState(false);
  const timezone = user.timezone, today = todayKey(timezone), days = weekDays(selected);
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const taskZone = (task: Task) => task.all_day ? task.timezone : timezone;
  const occurrences = (calendar?.tasks || []).filter(occ => { const date = occ.effective_due_at || occ.effective_start_at, task = tasksById.get(occ.task_id); return date && task && dateKey(date, taskZone(task)) === selected; });
  const rows = occurrences.map(occurrence => ({ occurrence, task: tasks.find(task => task.id === occurrence.task_id) })).filter((item): item is { occurrence: TaskOccurrence; task: Task } => Boolean(item.task));
  const dayEvents = (calendar?.events || []).filter(event => { const zone = event.all_day ? event.timezone : timezone; return dateKey(event.start_at, zone) <= selected && dateKey(new Date(new Date(event.end_at).getTime() - 1), zone) >= selected; });
  const doneCount = rows.filter(({ occurrence }) => occurrence.status === 'completed').length;
  const donePercent = rows.length ? Math.round(doneCount / rows.length * 100) : 0;
  const unscheduled = tasks.filter(task => !task.due_at && !task.start_at && !task.completed);
  const completedPeriod = dayLabel(selected, { month: 'long', year: 'numeric' }).replace(' г.', '');
  const completedScope = t("Разовые задачи — за всё время. Повторения — за {0}.", completedPeriod);
  const completedRepeats = (calendar?.tasks || []).filter(o => o.occurrence_at && o.status === 'completed').flatMap(occurrence => {
    const task = tasksById.get(occurrence.task_id), at = occurrence.effective_due_at || occurrence.effective_start_at;
    // The fetch has extra timezone padding and adjacent mini-calendar weeks.
    // Completed history deliberately follows the selected calendar month.
    return task && at && dateKey(at, taskZone(task)).slice(0, 7) === selected.slice(0, 7) ? [{ task, occurrence }] : [];
  });
  const completed = filter === 'day' ? rows.filter(row => row.occurrence.status === 'completed') : [...tasks.filter(task => task.completed).map(task => ({ task, occurrence: undefined })), ...completedRepeats];
  const isUpcoming = (task: Task) => {
    const at = task.next_occurrence_at || task.due_at || task.start_at;
    if (!at) return false;
    const tomorrow = shiftDay(today, 1);
    return task.all_day ? dateKey(at, task.timezone) >= tomorrow : Date.parse(at) >= Date.parse(startOfDay(tomorrow, timezone));
  };
  const visible: { task: Task; occurrence?: TaskOccurrence }[] = filter === 'day' ? rows.filter(row => row.occurrence.status !== 'completed') : filter === 'done' ? completed : tasks.filter(task => !task.completed && (filter === 'all' || isUpcoming(task))).map(task => ({ task, occurrence: filter === 'upcoming' ? calendar?.tasks.find(o => o.task_id === task.id && o.occurrence_at && task.next_occurrence_at && Date.parse(o.occurrence_at) === Date.parse(task.next_occurrence_at)) : rows.find(row => row.task.id === task.id)?.occurrence }));
  const highPriority = rows.filter(row => row.task.priority === 'high' && row.occurrence.status !== 'completed').length;
  const overdue = tasks.filter(task => !task.completed && !task.recurrence && (task.due_at || task.start_at) && dateKey((task.due_at || task.start_at)!, taskZone(task)) < today).length;
  const free=calendar?availableWindows(Date.parse(zonedISO(selected,'08:00',timezone)),Date.parse(zonedISO(selected,'22:00',timezone)),
    busyIntervals(calendar,tasks),60,15,selected===today?Date.now():0).filter(slot=>slot.kind==='free'):[];
  async function quickAdd(event: React.FormEvent) {
    event.preventDefault(); if (!quickTitle.trim()) return;
    setAdding(true); try { await api('/planning/tasks', { method: 'POST', body: { title: quickTitle.trim(), due_at: startOfDay(selected, timezone), all_day: true, timezone } }); setQuickTitle(''); await refresh(); notify(t("Задача добавлена")); } catch (e) { notify(errorMessage(e), 'error'); } finally { setAdding(false); }
  }
  const row = ({ task, occurrence }: { task: Task; occurrence?: TaskOccurrence }) => <TaskRow key={`${task.id}:${occurrence?.occurrence_at || ''}`} task={task} occurrence={occurrence} timezone={taskZone(task)} busy={busyIds.includes(task.id)} onToggle={() => onToggle(task, occurrence)} onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} showDate={filter !== 'day'} />;
  return <>
      <div className="week-strip today-week-strip"><button className="icon-button small" aria-label={t("Предыдущая неделя задач")} onClick={() => onSelect(shiftDay(selected, -7))}><ChevronLeft size={15} /></button>{days.map(day => <button key={day} className={`week-day ${day === selected ? 'selected' : ''} ${day === today ? 'today' : ''}`} onClick={() => { onSelect(day); setFilter('day'); }} aria-label={t("Задачи на {0}", dayLabel(day))} aria-pressed={day === selected}><span>{dayLabel(day, { weekday: 'short' })}</span><strong>{Number(day.slice(-2))}</strong><i /></button>)}<button className="icon-button small" aria-label={t("Следующая неделя задач")} onClick={() => onSelect(shiftDay(selected, 7))}><ChevronRight size={15} /></button></div>
    <div className="day-layout"><div className="day-primary"><section className="panel tasks-panel"><header className="task-panel-header"><div><h2>{filter === 'day' ? selected === today ? t("Задачи") : t("Задачи на {0}", dayLabel(selected)) : filter === 'upcoming' ? t("Предстоящие задачи") : filter === 'done' ? t("Выполненные задачи") : t("Все задачи")}<span className="count-badge">{visible.length}</span></h2><p>{filter === 'done' ? completedScope : highPriority ? t("{0} с высоким приоритетом — начните с главного", highPriority) : t("{0} на день · {1} готово", rows.length, doneCount)}</p></div><button className="icon-button" aria-label={t("Новая задача")} onClick={onCreate}><Plus size={20} /></button></header>
      <div className="task-filter-row"><div className="task-filters" role="group" aria-label={t("Фильтр задач")}>{([['day', t("На день")], ['upcoming', t("Предстоящие")], ['all', t("Все задачи")], ['done', t("Готово")]] as const).map(([key, title]) => <button key={key} className={key === filter ? 'selected' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}{key === 'done' && <CheckCheck size={13} />}</button>)}</div></div>
      {filter !== 'done' && <form className="task-quick-add" onSubmit={quickAdd}><Plus size={18} /><input value={quickTitle} onChange={e => setQuickTitle(e.target.value)} maxLength={300} aria-label={t("Быстро добавить задачу")} placeholder={t("Добавить задачу…")} disabled={adding} /><button className="quick-add-submit" disabled={!quickTitle.trim() || adding} type="submit">{adding ? t("Добавляем…") : t("Добавить")}<span>↵</span></button></form>}
      {visible.length ? <div className="task-list">{visible.map(row)}</div> : <EmptyState title={filter === 'done' ? t("Здесь будут ваши маленькие победы") : filter === 'upcoming' ? t("Впереди чистый лист") : t("Можно начать с одного дела")} text={filter === 'done' ? t("Отмечайте выполненные задачи — мы сохраним их здесь.") : t("Добавьте важное. Остальному найдётся своё время.")} icon={filter === 'done' ? <CircleCheck size={26} /> : <Sun size={27} />} />}
      {filter !== 'done' && completed.length > 0 && <div className="completed-section"><button className="completed-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}><ChevronDown size={15} className={showDone ? 'rotate' : ''} />{t("Выполнено")}<span>{completed.length}</span></button>{showDone && filter !== 'day' && <p className="agenda-date">{completedScope}</p>}{showDone && completed.map(row)}</div>}
      {filter === 'day' && unscheduled.length > 0 && <div className="unscheduled-section"><div className="section-heading"><span>{t("Без даты")}</span><span className="count-badge">{unscheduled.length}</span></div>{unscheduled.map(task => row({ task }))}</div>}
      {filter === 'day' && overdue > 0 && <button className="overdue-hint" onClick={() => setFilter('all')}><Clock3 size={14} />{plural(overdue, [t("задача ждёт"), t("задачи ждут"), t("задач ждут")])} {t("с прошлых дней")}<ArrowRight size={14} /></button>}
    </section></div>
      <aside className="day-aside"><section className="panel agenda-panel"><header className="section-heading"><h2>{t("Расписание")}</h2><LifeLink action={onCalendar}>{t("Календарь")}</LifeLink></header><p className="agenda-date">{dayLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</p>{dayEvents.length ? <div className="agenda-list">{dayEvents.map((event, index) => <button className={`agenda-event agenda-${index % 3}`} key={`${event.id}:${event.occurrence_at}`} onClick={() => onEvent(event)}><div className="agenda-time"><span>{event.all_day ? t("Весь день") : timeText(event.start_at, timezone)}</span>{!event.all_day && <small>{timeText(event.end_at, timezone)}</small>}</div><div><strong>{event.title}</strong><p>{event.notes || (event.recurrence ? t("Повторяющееся событие") : t("Личный календарь"))}</p></div></button>)}</div> : <div className="agenda-empty"><Coffee size={27} strokeWidth={1.4} /><strong>{t("Есть место для спонтанности")}</strong><p>{t("На этот день пока нет событий.")}</p><button className="text-button" onClick={onCreateEvent}>{t("Запланировать событие")}<Plus size={13} /></button></div>}<button className="agenda-calendar-link" onClick={onCalendar}>{t("Открыть календарь")}<ArrowRight size={15} /></button></section>
      {free.length>0&&<LifeCard><header className="life-card-head"><h3>{t("Свободное время")}</h3><LifeLink action={onFree}>{t("Все окна")}</LifeLink></header><div className="life-pills">{free.slice(0,3).map(slot=><button key={slot.start} onClick={onFree}>{timeText(new Date(slot.start).toISOString(),timezone)}–{timeText(new Date(slot.end).toISOString(),timezone)}</button>)}</div></LifeCard>}
      <LifeCard className="life-today-progress"><LifeRings size={72} label={donePercent+'%'} values={[{value:donePercent/100,color:'#245447'}]}/><div><h3>{doneCount} {t("из")} {rows.length} {t("задач")}</h3><p>{donePercent===100&&rows.length?t("Все задачи на день выполнены"):t("Прогресс выполнения за выбранный день")}</p></div></LifeCard>
    </aside></div>
  </>;
}
