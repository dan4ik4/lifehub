import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayLabel, monthDays, shiftMonth, todayKey } from '../lib/dates';

export function MiniCalendar({ selected, timezone, onSelect, marked = [] }: { selected: string; timezone: string; onSelect: (day: string) => void; marked?: string[] }) {
  const [month, setMonth] = useState(selected.slice(0, 8) + '01');
  const today = todayKey(timezone), days = monthDays(month);
  return <section className="mini-calendar" aria-label="Выбор даты"><header><h3>{dayLabel(month, { month: 'long', year: 'numeric' }).replace(' г.', '')}</h3><div><button className="icon-button small" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button><button className="icon-button small" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button></div></header><div className="mini-grid" role="group" aria-label="Дни месяца">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => <span className="weekday" key={d}>{d}</span>)}{days.map(d => <button key={d} className={`mini-day ${d === selected ? 'selected' : ''} ${d === today ? 'today' : ''} ${d.slice(0, 7) !== month.slice(0, 7) ? 'outside' : ''}`} aria-label={dayLabel(d, { day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={d === selected} aria-current={d === today ? 'date' : undefined} onClick={() => onSelect(d)}><span>{Number(d.slice(-2))}</span>{marked.includes(d) && <i />}</button>)}</div></section>;
}
