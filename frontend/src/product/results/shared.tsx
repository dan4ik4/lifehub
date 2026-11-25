import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api, errorMessage } from '../../lib/api';
import { dayLabel } from '../../lib/dates';
import { locale, t } from '../../lib/language';
import { formatAmount } from '../format';

const svg = import.meta.glob('./icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export type IconName = 'leaf' | 'home' | 'calendar' | 'target' | 'heart' | 'wallet' | 'book' | 'sparkles' |
  'settings' | 'search' | 'sun' | 'clock' | 'cl' | 'cr' | 'send' | 'trend' | 'flame' | 'check' | 'moon' |
  'activity' | 'smile' | 'plus' | 'arrow' | 'filter' | 'more' | 'info';
export const resultsRoot = '/modules/insights';
export function ResultsIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  const asset = svg['./icons/' + name + '.svg'];
  return <span aria-hidden="true" className="results-icon" data-icon={name}
    style={{ width: size, height: size, maskImage: 'url("' + asset + '")' }} />;
}

export function useResults<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({path, data});
    }).catch(error => {
      if (!controller.signal.aborted) setState({path, error: errorMessage(error)});
    });
    return () => controller.abort();
  }, [path, revision]);
  const fresh = state?.path === path ? state : undefined;
  return { data: fresh?.data, error: fresh?.error, reload };
}

export type Metric = 'tasks' | 'habits' | 'sleep' | 'workouts' | 'expenses' | 'pages' | 'mood' | 'steps';
export type Totals = Record<Exclude<Metric, 'steps' | 'expenses'>, number | null> & {expenses:string | null; books:number | null};
export type Daily = Record<Exclude<Metric, 'expenses'>, number | null> & {day:string; workout_minutes:number|null; expenses:Record<string,string>};
export type Entry = {start:string; end:string; currency:string; score:number|null; totals:Totals; days:Daily[]; summary:Metric[]};
export type Week = Entry & {
  kpi:{key:Exclude<Metric,'steps'|'mood'>;value:number|string|null;previous:number|string|null}[];
  previous:Totals; previous_score:number|null; best_day:Daily|null; hard_day:Daily|null;
  built_at:string|null; latest:string; ai_used:boolean; suggestions:string[]; has_data:boolean;
  recent:{ start:string; habits:number|null }[];
  budget:{category:string; percent:number; spent:string; amount:string; month:string}|null;
};
export type PairMeta = {id:string; x:Metric; y:Metric};
export type Pair = PairMeta & {threshold:string; lower_average:string; upper_average:string; paired_days:number;
  lower_days:number; upper_days:number; new:boolean; evidence:{day:string;x:string;y:string;group:'lower'|'upper'}[]};
export type PairData = {day:string; updated_at:string|null; days:string[]; available_modules:string[]; found:Pair[];
  hidden:string[]; collecting:(PairMeta&{n_days:number;needed:number})[]};
export type Archive = {items:Entry[]; trend:Entry[]; featured:Entry|null; current_month:string; latest:string; year:number; years:number[]};
export type Consent = {ai_enabled:boolean;decided:boolean};

export const metrics: Record<Metric,{label:string; icon:IconName; theme:string}> = {
  tasks:{label:t('Задачи'),icon:'check',theme:'indigo'},
  habits:{label:t('Привычки'),icon:'target',theme:'green'},
  sleep:{label:t('Сон'),icon:'moon',theme:'indigo'},
  workouts:{label:t('Тренировки'),icon:'activity',theme:'brown'},
  expenses:{label:t('Расходы'),icon:'wallet',theme:'gold'},
  pages:{label:t('Чтение'),icon:'book',theme:'leaf'},
  mood:{label:t('Настроение'),icon:'smile',theme:'leaf'},
  steps:{label:t('Шаги'),icon:'activity',theme:'brown'},
};
export function curr(code: string) { return code === 'PLN' ? 'zł' : code; }
export function minutes(value: number) {
  const rounded = Math.round(value);
  return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0');
}
export function measure(key: Metric, value: number | string | null) {
  if (value === null) return '—';
  return key === 'sleep' ? minutes(Number(value)) : formatAmount(value);
}
export function weekLabel(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return dayLabel(start, sameMonth ? {day:'numeric'} : {day:'numeric',month:'short'}) + ' – ' +
    dayLabel(end, {day:'numeric',month:sameMonth?'long':'short'});
}
export function monthLabel(start: string, year = false) {
  return dayLabel(start, {month:'long', ...(year ? {year:'numeric'} : {})});
}
export function pairLabel(pair: PairMeta) { return metrics[pair.x].label + ' × ' + metrics[pair.y].label; }

export function summaryText(entry: Entry) {
  const facts = {
    tasks: () => t('Задачи — {0}', measure('tasks', entry.totals.tasks)),
    habits: () => t('Привычки выполнены на {0}%', measure('habits', entry.totals.habits)),
    sleep: () => t('Средний сон — {0}', measure('sleep', entry.totals.sleep)),
    workouts: () => t('Тренировки — {0}', measure('workouts', entry.totals.workouts)),
    expenses: () => t('Траты — {0} {1}', measure('expenses', entry.totals.expenses), curr(entry.currency)),
    pages: () => t('Прочитано страниц — {0}', measure('pages', entry.totals.pages)),
    mood: () => t('Среднее настроение — {0} из 5', measure('mood', entry.totals.mood)),
    steps: () => '',
  };
  const observations = entry.summary.map(key => facts[key]?.()).filter(Boolean);
  return observations.length ? observations.join('. ') + '.' : t('За этот период пока нет записей.');
}

export function Chip({children, tone='neutral'}:{children:ReactNode;tone?:string}) {
  return <span className="results-chip" data-tone={tone}>{children}</span>;
}
export function GlyphTile({icon,tone,size=14}:{icon:IconName;tone:string;size?:number}) {
  return <span className="results-tile" data-tone={tone}><ResultsIcon name={icon} size={size}/></span>;
}
export function IconButton({icon,label,onClick,disabled=false}:{icon:IconName;label:string;onClick:()=>void;disabled?:boolean}) {
  return <button className="results-button results-icon-button" type="button" aria-label={label} title={label}
    onClick={onClick} disabled={disabled}><ResultsIcon name={icon}/></button>;
}
export function Segmented<T extends string|number>({items,value,onChange,label}:{
  items:readonly (readonly [T,string])[];value:T;onChange:(x:T)=>void;label:string;
}) {
  return <div className="results-segments" role="group" aria-label={label}>{items.map(([key,text])=>
    <button type="button" key={key} aria-pressed={key===value} onClick={()=>onChange(key)}>{text}</button>
  )}</div>;
}
export function LoadState({error,reload}:{error?:string;reload:()=>void}) {
  return error ? <p className="results-status" role="alert">{error} <button className="results-button" onClick={reload}>{t('Повторить')}</button></p>
    : <p className="results-status" role="status">{t('Загрузка…')}</p>;
}
export function intensity(value: number, max: number): CSSProperties {
  return {'--intensity': Math.min(100, Math.max(6, Math.round(value * 100 / Math.max(1,max)))) + '%'} as CSSProperties;
}
export function clockLabel(timestamp:string, timezone:string) {
  return new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit',timeZone:timezone,hourCycle:'h23'}).format(new Date(timestamp));
}
