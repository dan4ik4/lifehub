import { LifeCard, LifeRings } from '../../components/LifeCard';
import { dateKey, dayLabel, shiftDay } from '../../lib/dates';
import { t } from '../../lib/language';
import type { User } from '../../lib/types';
import { DiaryReview } from '../DiaryReview';
import { Chip, GlyphTile, IconButton, ResultsIcon, clockLabel, curr, intensity, measure, metrics, minutes, resultsRoot,
  summaryText, weekLabel } from './shared';
import type { Daily, Week } from './shared';

const calendarRows = ['habits','tasks','sleep','mood','expenses'] as const;
const categoryLabels: Record<string,string> = {
  food:t('Еда'), transport:t('Транспорт'), home:t('Дом'), health:t('Здоровье'), leisure:t('Досуг'), other:t('Другое'),
};

function delta({key,value,previous:prior}:Week['kpi'][number], currency:string) {
  if (value === null || prior === null) return null;
  const difference = Number(value) - Number(prior);
  if (!difference) return {text:t('Как на прошлой неделе'),tone:'neutral',short:'='};
  const change = key === 'expenses' && Number(prior) ? Math.round(100*difference/Number(prior)) : Math.round(difference);
  const amount = (change > 0 ? '+' : change < 0 ? '−' : '') + Math.abs(change);
  const unit = key === 'habits' ? t(' п.п.') : key === 'sleep' ? ' '+t('мин') :
    key === 'expenses' ? Number(prior) ? '%' : ' '+curr(currency) : '';
  return {text:key === 'tasks' ? t('{0} к прошлой', amount) : amount+unit,
    short:amount+unit, tone:(key === 'expenses' ? change < 0 : change > 0) ? 'leaf' : change === 0 || key === 'sleep' ? 'neutral' : 'red'};
}

function WeekMetrics({week}:{week:Week}) {
  return <div className="results-kpis">{week.kpi.map(kpi => {
    const {key,value} = kpi;
    const {label,icon,theme} = metrics[key], change = delta(kpi,week.currency);
    const unit = key === 'habits' ? '%' : key === 'sleep' ? t('ч') : key === 'expenses' ? curr(week.currency) : key === 'pages' ? t('стр.') : '';
    const compactLabel = key==='workouts' ? t('Трен.') : key==='expenses' ? t('Траты') : null;
    return <LifeCard key={key} className="results-kpi">
      <div className="results-kpi-label"><GlyphTile icon={icon} tone={theme}/>{compactLabel ? <>
        <span className="results-desktop-text">{label}</span><span className="results-mobile-text">{compactLabel}</span>
      </> : <span>{label}</span>}</div>
      <strong>{measure(key,value)}{value !== null && unit && <small>{unit}</small>}</strong>
      {change && <Chip tone={change.tone}><span className="results-desktop-text">{change.text}</span><span className="results-mobile-text">{change.short}</span></Chip>}
    </LifeCard>;
  })}</div>;
}

function dayValue(day:Daily, key:typeof calendarRows[number], currency:string) {
  return key === 'expenses' ? day.expenses[currency] ?? null : day[key];
}
function dayCell(day:Daily, key:typeof calendarRows[number], currency:string) {
  const value = dayValue(day,key,currency);
  if (value === null) return '';
  if (key === 'habits') return value === 100 ? <ResultsIcon name="check" size={15}/> : String(value) + '%';
  return key === 'mood' ? '' : measure(key,value);
}

function CalendarGrid({week}:{week:Week}) {
  return <LifeCard className="results-calendar">
    <h2>{t('Неделя по дням')}</h2><p>{t('Цвет клетки показывает значение')}</p>
    <div className="results-table-scroll"><table className="results-heat"><thead><tr>
      <th scope="col"><span className="sr-only">{t('Показатели')}</span></th>
      {week.days.map(day => <th key={day.day} scope="col">{dayLabel(day.day,{weekday:'short'})}</th>)}
    </tr></thead><tbody>{calendarRows.map(key => {
      const max = Math.max(1, ...week.days.map(day => Number(dayValue(day,key,week.currency) ?? 0)));
      return <tr key={key}><th scope="row"><ResultsIcon name={metrics[key].icon} size={15}/>
        {key==='expenses' ? t('Траты, {0}',curr(week.currency)) : metrics[key].label}</th>
        {week.days.map(day=>{
          const value = dayValue(day,key,week.currency);
          const reported = value === null ? t('Нет данных') : measure(key,value)+(key==='habits'?'%':'');
          return <td key={day.day}><span data-metric={key} data-missing={value===null || undefined}
            data-highlight={key==='sleep'&&value!==null&&Number(value)<420?'low':key==='expenses'&&value!==null&&Number(value)>=max*.8?'high':undefined}
            className="results-heat-cell" title={reported} aria-label={reported}
            style={intensity(Number(value??0),key==='mood'?5:key==='habits'?100:max)}>{dayCell(day,key,week.currency)}</span></td>;
        })}
      </tr>;
    })}</tbody></table></div>
  </LifeCard>;
}

function DayTile({day,best,currency}:{day:Daily|null;best:boolean;currency:string}) {
  if (!day) return null;
  const lines = [
    day.habits!==null && t('Привычки выполнены на {0}%',day.habits),
    day.tasks!==null && t('Задачи — {0}',day.tasks),
    day.mood!==null && t('Настроение — {0} из 5',measure('mood',day.mood)),
    day.sleep!==null && t('Сон — {0}',minutes(day.sleep)),
    day.workout_minutes!==null && t('Тренировки — {0} мин',day.workout_minutes),
    day.expenses[currency]!==undefined && t('Траты — {0} {1}', measure('expenses',day.expenses[currency]),curr(currency)),
  ].filter(Boolean);
  return <div className="results-day-tile"><Chip tone={best?'leaf':'red'}>{best?t('лучший'):t('сложный')}</Chip>
    <h3>{dayLabel(day.day,{weekday:'long',day:'numeric'})}</h3><ul>{lines.slice(0,3).map(line=><li key={String(line)}>{line}</li>)}</ul>
  </div>;
}

function Suggestions({week,navigate}:{week:Week;navigate:(to:string)=>void}) {
  const budget = week.budget;
  const items = {
    habits:{icon:'moon',tone:'indigo',title:t('Ложиться до 23:30 в будни'),compactTitle:t('Сон до 23:30 в будни'),
      detail:week.totals.sleep!==null?t('Средний сон за неделю — {0}.', minutes(week.totals.sleep)):t('Добавьте привычку, чтобы следить за режимом сна.'),
      label:t('Создать привычку'),short:t('+ Привычка'),to:'/modules/goals_habits?new=habit&preset=bedtime'},
    budget:{icon:'wallet',tone:'gold',title:budget?t('{0} — {1}% лимита',categoryLabels[budget.category]??budget.category,budget.percent):t('Проверить расходы'),
      detail:budget?t('{0} из {1} {2}',measure('expenses',budget.spent),measure('expenses',budget.amount),curr(week.currency)):
        t('Посмотрите расходы по категориям и планы на месяц.'),
      label:budget?t('Открыть бюджет'):t('Открыть траты'),short:budget?t('Бюджет'):t('Траты'),to:budget?
        '/modules/finance/budgets?'+new URLSearchParams({month:budget.month,currency:week.currency,category:budget.category}):
        '/modules/finance/transactions?'+new URLSearchParams({currency:week.currency})},
    planning:{icon:'calendar',tone:'indigo',title:t('Разгрузить понедельник'),
      detail:t('Откройте планы на понедельник и при необходимости перенесите задачу.'),
      label:t('Перенести задачу'),short:t('Перенести'),to:'/planning?day='+shiftDay(week.end,1)},
  } as const;
  if (!week.suggestions.length) return null;
  return <section className="results-suggestions"><header><h2>{t('На следующую неделю')}</h2>
    <p>{t('Шаги, которые подсказывают цифры')}</p></header><div className="results-suggestion-grid">
    {week.suggestions.map(key => {
      const item = items[key as keyof typeof items];
      if (!item) return null;
      return <LifeCard className="results-suggestion" key={key}>
        <GlyphTile icon={item.icon} tone={item.tone} size={18}/><h3>{'compactTitle' in item ? <>
          <span className="results-desktop-text">{item.title}</span><span className="results-mobile-text">{item.compactTitle}</span>
        </> : item.title}</h3><p>{item.detail}</p>
        <button type="button" className={'results-button'+(key==='habits'?' results-soft':'')} onClick={()=>navigate(item.to)}
          aria-label={item.label}><ResultsIcon name={key==='habits'?'plus':'arrow'} size={14}/>
          <span className="results-desktop-text">{item.label}</span><span className="results-mobile-text">{item.short}</span>
        </button>
      </LifeCard>;
    })}
  </div></section>;
}

export function WeekView({week,user,pro,ai,navigate,onConsent,onShare}:{week:Week;user:User;pro:boolean;ai:boolean;
  navigate:(to:string)=>void;onConsent:()=>void;onShare:()=>void}) {
  const title = weekLabel(week.start,week.end);
  const byDate = (delta:number)=>navigate(resultsRoot+'?start='+shiftDay(week.start,delta));
  return <>
    <header className="results-heading results-week-heading">
      <div><div className="results-kicker">{t('Итоги недели')}</div><div className="results-date">
        <IconButton icon="cl" label={t('Предыдущая неделя')} onClick={()=>byDate(-7)} disabled={week.start<='1900-01-22'}/>
        <h1>{title}</h1><IconButton icon="cr" label={t('Следующая неделя')} onClick={()=>byDate(7)} disabled={week.start>=week.latest}/>
      </div><p>{week.built_at?t('Собрано {0} в {1} из всех доступных модулей',
        dayLabel(dateKey(week.built_at,user.timezone)),clockLabel(week.built_at,user.timezone)):t('Итоги собираются в воскресенье в 20:00')}</p></div>
      <button className="results-button results-share" type="button" onClick={onShare} aria-label={t('Поделиться')}><ResultsIcon name="send"/><span>{t('Поделиться')}</span></button>
    </header>
    <section className="results-hero">
      <div><div className="results-kicker"><ResultsIcon name="sparkles"/>{t('Главное за неделю')}
        {week.score!==null && <span className="results-hero-mobile-score"> · {t('Оценка {0}',week.score)}</span>}</div>
        <p>{summaryText(week)}</p>
        <div className="results-hero-chips">
          {week.score!==null && week.previous_score!==null && week.score>week.previous_score &&
            <Chip><ResultsIcon name="trend" size={12}/>{t('Лучше прошлой недели')}</Chip>}
          {week.totals.habits!==null && <Chip><ResultsIcon name="flame" size={12}/>{t('Привычки выполнены на {0}%',week.totals.habits)}</Chip>}
        </div>
      </div>
      <div className="results-hero-score"><LifeRings values={[{value:(week.score??0)/100,color:'#cdebd8',track:'#2f6153'}]} size={120} label={t('Оценка недели · {0}',week.score??'—')}/>
        <span>{t('Оценка недели · {0}',week.score??'—')}</span>
      </div>
    </section>
    <WeekMetrics week={week}/>
    <div className="results-week-grid">
      <CalendarGrid week={week}/>
      <LifeCard className="results-two-days"><h2>{t('Два дня недели')}</h2>
        {week.best_day || week.hard_day ? <>
          <DayTile day={week.best_day} best currency={week.currency}/>
          <DayTile day={week.hard_day} best={false} currency={week.currency}/>
        </> : <p>{t('За этот период пока нет записей.')}</p>}
      </LifeCard>
    </div>
    <Suggestions week={week} navigate={navigate}/>
    <button className="results-button results-share-mobile" type="button" onClick={onShare}>
      <ResultsIcon name="send"/>{t('Поделиться')}
    </button>
    {pro && <details className="results-review-disclosure"><summary>{t('Недельный обзор дневника')}</summary>
      <DiaryReview key={week.start} pro revision={week.built_at} endDay={week.end} resultsConsent={ai}
        onConsent={onConsent} onSource={day=>navigate('/modules/books/diary?day='+encodeURIComponent(day))}/>
    </details>}
  </>;
}
