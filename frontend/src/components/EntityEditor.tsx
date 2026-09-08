import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, CalendarDays, CheckSquare, ChevronDown, Clock3, Crown, LoaderCircle, Repeat2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { dateKey, parts, shiftDay, zonedISO } from '../lib/dates';
import { recurrenceLabel } from '../lib/recurrenceLabel';
import type { CalendarEvent, Priority, Task } from '../lib/types';
import { Modal } from './ui';

const recurrenceOptions = [
  ['', 'Не повторять'], ['FREQ=DAILY', 'Каждый день'], ['FREQ=WEEKLY', 'Каждую неделю'],
  ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'По будням'], ['FREQ=MONTHLY', 'Каждый месяц'],
];

type EntityKind = 'task' | 'event';
type Entity = Task | CalendarEvent;
export interface EntityFields {
  title: string; notes: string; date: string; time: string; endDate: string; endTime: string;
  hasDate: boolean; allDay: boolean; priority: Priority; rrule: string; reminder: string;
  hasStart: boolean; startDate: string; startTime: string;
}

function timeOf(value: string | null | undefined, timezone: string, fallback: string): string {
  if (!value) return fallback;
  const p = parts(value, timezone);
  return `${p.hour}:${p.minute}`;
}

export function initialEntityFields(kind: EntityKind, item: Entity | undefined, day: string, timezone: string, initialTime = '10:00'): EntityFields {
  const isTask = kind === 'task';
  const task = isTask ? item as Task | undefined : undefined;
  const zone = item?.timezone || timezone;
  const anchor = isTask ? task?.due_at : item?.start_at;
  const end = !isTask ? (item as CalendarEvent | undefined)?.end_at : undefined;
  const initialHour = Number(initialTime.split(':')[0]);
  return {
    title: item?.title || '', notes: item?.notes || '',
    date: anchor ? dateKey(anchor, zone) : day, time: timeOf(anchor, zone, initialTime),
    endDate: end ? shiftDay(dateKey(end, zone), item?.all_day ? -1 : 0) : shiftDay(day, initialHour === 23 ? 1 : 0),
    endTime: timeOf(end, zone, `${String((initialHour + 1) % 24).padStart(2, '0')}:${initialTime.split(':')[1] || '00'}`),
    hasDate: !item || Boolean(anchor), allDay: item?.all_day ?? isTask,
    priority: task?.priority || 'none', rrule: item?.recurrence?.rrule || '', reminder: item ? 'keep' : 'none',
    hasStart: isTask && Boolean(task?.start_at), startDate: task?.start_at ? dateKey(task.start_at, zone) : day,
    startTime: timeOf(task?.start_at, zone, '09:00'),
  };
}

function timestamp(day: string, time: string, timezone: string, allDay: boolean, original: string | null | undefined, originallyAllDay?: boolean): string {
  // The minute-resolution form must not erase seconds or choose a different DST
  // fold when the user edits only a title, note, priority, or reminder.
  if (original && originallyAllDay === allDay && dateKey(original, timezone) === day
    && timeOf(original, timezone, '') === time) return original;
  return zonedISO(day, time, timezone);
}

export function entityPayload(kind: EntityKind, item: Entity | undefined, fields: EntityFields, timezone: string, pro: boolean): Record<string, unknown> {
  const isTask = kind === 'task';
  const task = isTask ? item as Task | undefined : undefined;
  const zone = item?.timezone || timezone;
  if (!fields.title.trim()) throw new Error('Добавьте название — так будет проще найти запись.');
  if (!pro && (fields.rrule || isTask && fields.priority !== 'none')) {
    throw new Error('Для сохранения на Free отключите повторение и приоритет или подключите Pro.');
  }
  const allDay = (fields.hasDate || fields.hasStart || !isTask) && fields.allDay;
  const at = fields.hasDate || !isTask
    ? timestamp(fields.date, allDay ? '00:00' : fields.time, zone, allDay, isTask ? task?.due_at : item?.start_at, item?.all_day) : null;
  const body: Record<string, unknown> = {
    title: fields.title.trim(), notes: fields.notes.trim() || null, timezone: zone, all_day: allDay, rrule: fields.rrule || null,
  };
  if (item) body.version = item.version;
  if (isTask) {
    body.due_at = at;
    body.start_at = fields.hasStart
      ? timestamp(fields.startDate, allDay ? '00:00' : fields.startTime, zone, allDay, task?.start_at, item?.all_day) : null;
    body.priority = fields.priority;
    if (body.start_at && at && Date.parse(String(body.start_at)) > Date.parse(at)) {
      throw new Error('Начало задачи не должно быть позже дедлайна.');
    }
  } else {
    body.start_at = at;
    body.end_at = timestamp(allDay ? shiftDay(fields.endDate, 1) : fields.endDate, allDay ? '00:00' : fields.endTime,
      zone, allDay, (item as CalendarEvent | undefined)?.end_at, item?.all_day);
    if (Date.parse(String(body.end_at)) <= Date.parse(String(at))) throw new Error('Окончание события должно быть позже начала.');
  }
  if (fields.rrule && !at && !body.start_at) throw new Error('Для повторения нужна дата. Укажите начало или дедлайн.');
  if (fields.reminder !== 'keep') {
    if (fields.reminder !== 'none' && !at && !body.start_at) throw new Error('Добавьте дату, чтобы настроить напоминание.');
    body.reminders = fields.reminder === 'none' ? [] : [{ offset_minutes: Number(fields.reminder), channel: 'email' }];
  } else if (isTask && !at && !body.start_at && task?.reminders.some(reminder => reminder.offset_minutes !== null)) {
    throw new Error('Уберите текущее напоминание или оставьте дату начала / дедлайн.');
  }
  return body;
}

export function EntityEditor({ kind, item, day, initialTime, timezone, pro, onClose, onSaved, onUpgrade }: {
  kind: 'task' | 'event'; item?: Task | CalendarEvent; day: string; initialTime?: string; timezone: string;
  pro: boolean; onClose: () => void; onSaved: () => void; onUpgrade: () => void;
}) {
  const isTask = kind === 'task', task = isTask ? item as Task | undefined : undefined;
  const zone = item?.timezone || timezone;
  const [initial] = useState(() => initialEntityFields(kind, item, day, timezone, initialTime));
  const [title, setTitle] = useState(initial.title), [notes, setNotes] = useState(initial.notes);
  const [date, setDate] = useState(initial.date), [time, setTime] = useState(initial.time);
  const [endDate, setEndDate] = useState(initial.endDate), [endTime, setEndTime] = useState(initial.endTime);
  const [hasDate, setHasDate] = useState(initial.hasDate), [allDay, setAllDay] = useState(initial.allDay);
  const [priority, setPriority] = useState<Priority>(initial.priority), [rrule, setRrule] = useState(initial.rrule);
  const [reminder, setReminder] = useState(initial.reminder), [hasStart, setHasStart] = useState(initial.hasStart);
  const [startDate, setStartDate] = useState(initial.startDate), [startTime, setStartTime] = useState(initial.startTime);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const busyRef = useRef(false);
  const [advanced, setAdvanced] = useState(Boolean(item?.recurrence || task?.start_at));
  const readOnly = !isTask && Boolean((item as CalendarEvent | undefined)?.external_read_only);
  const premiumBlocked = !pro && Boolean(rrule || isTask && priority !== 'none');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || readOnly) return;
    setError('');
    let body: Record<string, unknown>;
    try {
      body = entityPayload(kind, item, { title, notes, date, time, endDate, endTime, hasDate, allDay, priority, rrule, reminder, hasStart, startDate, startTime }, timezone, pro);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте заполненные поля.');
      return;
    }
    busyRef.current = true; setBusy(true);
    try {
      await api(`/planning/${isTask ? 'tasks' : 'events'}${item ? '/' + item.id : ''}`, { method: item ? 'PATCH' : 'POST', body });
      onSaved(); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { busyRef.current = false; setBusy(false); }
  }
  return <Modal title={readOnly ? 'Просмотр события' : item ? isTask ? 'Редактировать задачу' : 'Редактировать событие' : isTask ? 'Новая задача' : 'Новое событие'} description={item?.recurrence ? 'Изменения будут применены ко всей серии.' : 'Освободите голову — сохраните важное здесь.'} onClose={() => !busy && onClose()} className="entity-modal">
    <form onSubmit={save} aria-busy={busy}><div className="modal-body editor-body" inert={busy}><div className={`entity-type ${isTask ? '' : 'event-type'}`}>{isTask ? <CheckSquare size={15} /> : <CalendarDays size={15} />}{isTask ? 'Задача' : 'Событие'}<span>Планирование</span></div>
      <label className="field">Название<input className="input title-input" autoFocus required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} disabled={readOnly} placeholder={isTask ? 'Что хотите сделать?' : 'Что запланировано?'} /></label>
      <label className="field">Заметка <span className="optional">необязательно</span><textarea className="input" rows={3} maxLength={20000} value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} placeholder="Детали, ссылки или пара мыслей…" /></label>
      {isTask && <label className="switch-row"><span><CalendarDays size={17} />Добавить дедлайн</span><input type="checkbox" role="switch" checked={hasDate} onChange={e => setHasDate(e.target.checked)} /></label>}
      {(hasDate || !isTask) && <><div className="form-grid"><label className="field">{isTask ? 'Дата' : 'Начало'}<input className="input" type="date" required value={date} disabled={readOnly} onChange={e => { setDate(e.target.value); if (!item && endDate < e.target.value) setEndDate(e.target.value); }} /></label>{!allDay && <label className="field">{isTask ? 'Время дедлайна' : 'Время начала'}<input className="input" type="time" required value={time} disabled={readOnly} onChange={e => setTime(e.target.value)} /></label>}</div>
        {!isTask && <div className="form-grid"><label className="field">Окончание<input className="input" type="date" required min={date} value={endDate} disabled={readOnly} onChange={e => setEndDate(e.target.value)} /></label>{!allDay && <label className="field">Время окончания<input className="input" type="time" required value={endTime} disabled={readOnly} onChange={e => setEndTime(e.target.value)} /></label>}</div>}
        </>}
      {(hasDate || hasStart || !isTask) && <label className="switch-row"><span><Clock3 size={17} />Весь день</span><input type="checkbox" role="switch" checked={allDay} disabled={readOnly} onChange={e => setAllDay(e.target.checked)} /></label>}
      <button type="button" className="editor-expand" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><span>Дополнительные настройки</span><ChevronDown size={17} className={advanced ? 'rotate' : ''} /></button>
      {advanced && <div className="advanced-fields">
        {isTask && <label className="field">Приоритет {!pro && <span className="pro-label"><Crown size={12} />Pro</span>}<select className="input" value={priority} onChange={e => setPriority(e.target.value as Priority)} disabled={!pro && priority === 'none'}><option value="none">Без приоритета</option><option value="low" disabled={!pro}>Низкий</option><option value="medium" disabled={!pro}>Средний</option><option value="high" disabled={!pro}>Высокий</option></select></label>}
        <label className="field"><span className="inline-icon"><Repeat2 size={15} />Повторение {!pro && <span className="pro-label"><Crown size={12} />Pro</span>}</span><select className="input" disabled={!pro && !rrule || readOnly} value={rrule} onChange={e => setRrule(e.target.value)}>{recurrenceOptions.map(([value, label]) => <option key={value} value={value} disabled={Boolean(value) && !pro}>{label}</option>)}{rrule && !recurrenceOptions.some(([r]) => r === rrule) && <option value={rrule} disabled={!pro}>{recurrenceLabel(rrule, zone)}</option>}</select></label>
        {!pro && <button type="button" className="text-button" onClick={onUpgrade}>Посмотреть возможности Pro <Crown size={13} /></button>}
        {isTask && <><label className="switch-row"><span>Запланировать начало</span><input type="checkbox" role="switch" checked={hasStart} onChange={e => setHasStart(e.target.checked)} /></label>{hasStart && <div className="form-grid"><label className="field">Дата начала<input className="input" type="date" value={startDate} required onChange={e => setStartDate(e.target.value)} /></label>{!allDay && <label className="field">Время начала<input className="input" type="time" value={startTime} required onChange={e => setStartTime(e.target.value)} /></label>}</div>}</>}
        <label className="field"><span className="inline-icon"><Bell size={15} />Напоминание на почту</span><select className="input" disabled={readOnly} value={reminder} onChange={e => setReminder(e.target.value)}>{item && <option value="keep">Оставить текущие напоминания</option>}<option value="none">Без напоминания</option><option value="0">В момент начала / дедлайна</option><option value="5">За 5 минут</option><option value="15">За 15 минут</option><option value="30">За 30 минут</option><option value="60">За час</option><option value="1440">За день</option></select></label>
      </div>}
      <p className="timezone-note"><Clock3 size={12} />Часовой пояс: {zone.replaceAll('_', ' ')}</p>
      {premiumBlocked && !readOnly && <div className="notice"><p>Для редактирования на Free отключите повторение и приоритет. С Pro их можно сохранить.</p><button type="button" className="button secondary small" onClick={() => { setRrule(''); setPriority('none'); setError(''); }}>Убрать функции Pro</button><button type="button" className="text-button" onClick={onUpgrade}>Посмотреть Pro <Crown size={13} /></button></div>}
      {readOnly && <p className="notice">Это событие доступно только для чтения. Измените его в исходном календаре.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div><footer className="modal-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Отмена</button>{!readOnly && <button className="button primary" type="submit" disabled={busy || premiumBlocked}>{busy && <LoaderCircle className="spinner" size={16} />}{item ? 'Сохранить изменения' : isTask ? 'Создать задачу' : 'Создать событие'}</button>}</footer></form>
  </Modal>;
}
