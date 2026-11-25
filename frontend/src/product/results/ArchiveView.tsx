import {useState} from 'react';
import {LifeCard, LifeRings} from '../../components/LifeCard';
import {Modal} from '../../components/ui';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {FinanceAnalysis} from '../FinanceAnalysis';
import {Chip, ResultsIcon, Segmented, curr, measure, monthLabel, resultsRoot, summaryText, weekLabel} from './shared';
import type {Archive, Entry} from './shared';

export function archiveMonths(entries:Entry[]) {
  const sorted = new Map<string,Entry[]>();
  for (const entry of entries) {
    const key = entry.end.slice(0,7) + '-01';
    sorted.set(key,[...(sorted.get(key)??[]),entry]);
  }
  return sorted;
}

function PeriodChips({entry,featured=false}:{entry:Entry;featured?:boolean}) {
  const {totals,currency} = entry;
  return <span className="results-period-chips">
    {totals.habits!==null&&<Chip tone={featured?'green':'neutral'}>{t('привычки {0}%',totals.habits)}</Chip>}
    {featured&&totals.sleep!==null&&<Chip tone="indigo">{t('сон {0}',measure('sleep',totals.sleep))}</Chip>}
    {!featured&&totals.tasks!==null&&<Chip>{t('задачи {0}',totals.tasks)}</Chip>}
    {totals.expenses!==null&&<Chip tone={featured?'gold':'neutral'}>{measure('expenses',totals.expenses)} {curr(currency)}</Chip>}
    {featured&&totals.books!==null&&<Chip tone="leaf">{t('Книг прочитано: {0}',totals.books)}</Chip>}
  </span>;
}

function Ring({score,size=56,featured=false}:{score:number|null;size?:number;featured?:boolean}) {
  const color = featured || score===null || score < 70 ? score!==null&&score<50?'#c9aaa0':'#8a6a22' : '#245447';
  return <LifeRings size={size} values={[{value:(score??0)/100,color,track:featured?'#ede5cd':'#ebf0ea'}]}
    label={t('Оценка {0}',score??'—')}/>;
}

function WeekList({data,navigate}:{data:Archive;navigate:(to:string)=>void}) {
  return <section className="results-archive-list">{Array.from(archiveMonths(data.items)).map(([month,entries])=>
    <div key={month} id={'archive-'+month}><h2 className="results-kicker">{monthLabel(month)}</h2>
      {entries.map(entry=><button key={entry.start} className="results-archive-row" data-current={entry.start===data.latest||undefined}
        onClick={()=>navigate(resultsRoot+'?start='+entry.start)}>
        <span className="results-archive-score"><Ring score={entry.score}/><b>{entry.score??'—'}</b></span>
        <span className="results-archive-row-copy"><span className="results-archive-date">{weekLabel(entry.start,entry.end)}
          {entry.start===data.latest&&<Chip tone="green">{t('эта неделя')}</Chip>}</span>
          <strong>{summaryText(entry)}</strong><PeriodChips entry={entry}/>
        </span>
        <span className="results-archive-mini" aria-hidden="true">{entry.days.map(day=>
          <i key={day.day} data-shade={day.mood===null?'missing':day.mood>=4?'high':day.mood>=3?'middle':'low'}/>)}</span>
        <ResultsIcon name="cr"/>
      </button>)}
    </div>
  )}</section>;
}
function Trend({entries,navigate}:{entries:Entry[];navigate:(to:string)=>void}) {
  const best = entries.reduce<Entry|undefined>((best,entry)=>!best||(entry.score??0)>(best.score??0)?entry:best,undefined);
  return <LifeCard className="results-trend"><h2>{t('Оценка по неделям')}</h2><p>{t('Последние 7 недель')}</p>
    {entries.length>0&&<div className="results-trend-bars" style={{gridTemplateColumns:'repeat('+entries.length+',minmax(0,1fr))'}}>
      {entries.map((entry,index)=><button type="button" className="results-trend-bar" key={entry.start}
        aria-label={weekLabel(entry.start,entry.end)+' · '+t('Оценка {0}',entry.score)}
        onClick={()=>navigate(resultsRoot+'?start='+entry.start)} data-latest={index===entries.length-1||undefined}>
        <span>{entry.score}</span><i style={{height:(entry.score??0)+'%'}}/></button>)}
    </div>}
    {best&&<div className="results-trend-best"><p>{t('Лучшая неделя')}</p><button type="button" className="results-text"
      onClick={()=>navigate(resultsRoot+'?start='+best.start)}>
      {weekLabel(best.start,best.end)} · {best.score}</button></div>}
    <p>{t('Из чего оценка')}</p><p>{t('привычки 40% · задачи 20% · сон 20% · настроение 20%')}</p>
    <p>{t('В оценке учитываются только показатели, по которым есть данные.')}</p>
  </LifeCard>;
}

export function ArchiveView({data,mode,user,pro,ai,onMode,onYear,onConsent,navigate}:{data:Archive;mode:'week'|'month';user:User;
  pro:boolean;ai:boolean;onMode:(mode:'week'|'month')=>void;onYear:(year:number)=>void;onConsent:()=>void;navigate:(to:string)=>void}) {
  const [focused,setFocused] = useState<Entry|null>(null);
  const featured = data.featured;
  return <>
    <header className="results-heading">
      <div><div className="results-kicker">{t('Итоги')}</div><h1>{t('Архив')}</h1>
        <p>{t('Каждая неделя сохраняется сама — можно вернуться и сравнить')}</p></div>
      <div className="results-heading-actions">
        {data.years.length>1&&<select aria-label={t('Год')} className="results-button" value={data.year} onChange={event=>onYear(Number(event.target.value))}>
          {data.years.map(year=><option key={year}>{year}</option>)}
        </select>}
        <Segmented items={[[ 'week',t('Недели')],['month',t('Месяцы')]] as const} value={mode} onChange={onMode} label={t('Архив')}/>
      </div>
    </header>
    {featured&&<LifeCard className="results-month-feature"><div className="results-month-ring"><Ring score={featured.score} size={96} featured/>
      <small>{monthLabel(featured.start)} · {featured.score??'—'}</small></div>
      <div className="results-month-copy"><div className="results-kicker"><ResultsIcon name="sparkles" size={14}/>{monthLabel(featured.start,true)}
        {featured.start===data.current_month&&<> · {t('месяц ещё идёт')}</>}</div>
        <p>{summaryText(featured)}</p><PeriodChips entry={featured} featured/>
      </div></LifeCard>}
    <div className="results-archive-grid">
      {data.items.length===0 ? <LifeCard className="results-archive-empty"><h2>{t('Архив пока пуст')}</h2>
        <p>{t('Здесь будут итоги недель и месяцев, за которые есть записи.')}</p></LifeCard>:
        mode==='week'?<WeekList data={data} navigate={navigate}/>:<section className="results-archive-list">
          {data.items.map(entry=><button type="button" key={entry.start} id={'archive-'+entry.start}
            className="results-archive-row results-month-row" onClick={()=>setFocused(entry)}>
            <span className="results-archive-score"><Ring score={entry.score}/><b>{entry.score??'—'}</b></span>
            <span className="results-archive-row-copy"><span className="results-archive-date">{monthLabel(entry.start,true)}</span>
              <strong>{summaryText(entry)}</strong><PeriodChips entry={entry} featured/></span>
            <ResultsIcon name="cr"/>
          </button>)}
        </section>}
      <Trend entries={data.trend} navigate={navigate}/>
    </div>
    {focused&&<Modal title={monthLabel(focused.start,true)} onClose={()=>setFocused(null)} className="results-dialog results-month-dialog">
      <div className="modal-body"><p>{summaryText(focused)}</p><PeriodChips entry={focused} featured/>
        {pro&&<FinanceAnalysis user={user} month={focused.start.slice(0,7)} currency={focused.currency} pro={pro}
          revision={focused.start} includeReview resultsConsent={ai} onConsent={onConsent}/>}
      </div>
    </Modal>}
  </>;
}
