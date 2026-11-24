import { t } from '../lib/language';
import { CalendarDays, Clock3, Flag, MoreHorizontal, Repeat2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { shortDate, timeText } from '../lib/dates';
import { recurrenceLabel } from '../lib/recurrenceLabel';
import type { Task, TaskOccurrence } from '../lib/types';
import { CheckButton } from './ui';

const priorities = { none: '', low: t("Низкий"), medium: t("Средний"), high: t("Высокий") };
export function TaskRow({ task, occurrence, timezone, busy, onToggle, onEdit, onDelete, showDate = false }: {
  task: Task; occurrence?: TaskOccurrence; timezone: string; busy: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void; showDate?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const complete = occurrence ? occurrence.status === 'completed' : task.completed;
  const displayTimezone = task.all_day ? task.timezone : timezone;
  const at = occurrence?.effective_due_at || occurrence?.effective_start_at || (task.recurrence ? task.next_occurrence_at : null) || task.due_at || task.start_at;
  return <div className={`task-row ${complete ? 'completed' : ''}`}>
    <CheckButton checked={complete} busy={busy} onClick={onToggle} label={`${complete ? t("Вернуть в задачи") : t("Выполнить")}: ${task.title}`} />
    <button className="task-content" onClick={onEdit}><span className="task-title">{task.title}</span><span className="task-meta">{at && (showDate || !task.all_day) && <span>{task.all_day ? <CalendarDays size={12} /> : <Clock3 size={12} />}{showDate ? shortDate(at, displayTimezone) : ''}{showDate && !task.all_day ? ' · ' : ''}{!task.all_day ? timeText(at, timezone) : ''}</span>}{task.recurrence && <span><Repeat2 size={12} />{recurrenceLabel(task.recurrence.rrule, task.recurrence.timezone)}</span>}{task.notes && <span className="task-note">{task.notes}</span>}</span></button>
    {task.priority !== 'none' && <span className={`priority-dot priority-${task.priority}`} title={t("{0} приоритет", priorities[task.priority])}><Flag size={13} fill="currentColor" /><span>{priorities[task.priority]}</span></span>}
    <div className="task-actions"><button className="icon-button small" aria-label={t("Действия: {0}", task.title)} aria-expanded={menu} onClick={() => setMenu(!menu)} onBlur={e => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setMenu(false); }}><MoreHorizontal size={18} /></button>{menu && <div className="action-menu"><button onClick={() => { setMenu(false); onEdit(); }}>{t("Редактировать")}</button><button className="danger-text" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={14} />{t("Удалить")}</button></div>}</div>
  </div>;
}
