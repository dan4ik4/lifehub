import {useState} from 'react';
import {LifeCard} from '../../components/LifeCard';
import {Modal} from '../../components/ui';
import {dayLabel} from '../../lib/dates';
import {t} from '../../lib/language';
import {currencyCodes} from '../schema';
import {formatAmount} from '../format';
import {Chip,IconButton,ResultsIcon,Segmented,curr,pairLabel,metrics,clockLabel} from './shared';
import type {Metric,Pair,PairData} from './shared';

const moduleNames:Record<string,string> = {
  planning:t('Планирование'), goals_habits:t('Привычки'), health:t('Здоровье'), finance:t('Финансы'), books:t('Книги и дневник'),
};
const routes:Record<Metric,string> = {
  tasks:'/planning', habits:'/modules/goals_habits', sleep:'/modules/health/sleep', workouts:'/modules/health/workouts',
  expenses:'/modules/finance/transactions', pages:'/modules/books', mood:'/modules/books/diary', steps:'/modules/health?connect=1',
};

function metricValue(key:Metric, value:number|string, currency:string) {
  return formatAmount(value) + (key==='sleep'?' '+t('ч'):key==='expenses'?' '+curr(currency):
    key==='habits'?'%':key==='workouts'?' '+t('мин'):'');
}

function observation(pair:Pair, currency:string) {
  if (pair.x==='sleep' && pair.y==='habits' && Number(pair.upper_average)>Number(pair.lower_average)) {
    return t('При сне от {0} привычки выполняются чаще',metricValue(pair.x,pair.threshold,currency));
  }
  if (pair.x==='expenses' && pair.y==='mood' && Number(pair.upper_average)<Number(pair.lower_average)) {
    return t('При тратах от {0} настроение ниже',metricValue(pair.x,pair.threshold,currency));
  }
  return t('{0} и {1}: как различаются две группы',metrics[pair.x].label,metrics[pair.y].label);
}

export function PairDots({x,y}:{x:Metric;y:Metric}) {
  return <span className="results-pair-dots" aria-hidden="true"><i data-tone={metrics[x].theme}/><i data-tone={metrics[y].theme}/></span>;
}

function PairCard({pair,currency,days,navigate,onDetails,onHide,disabled,featured}:{
  pair:Pair;currency:string;days:string[];navigate:(to:string)=>void;onDetails:()=>void;onHide:()=>void;disabled:boolean;featured:boolean;
}) {
  const threshold = metricValue(pair.x,pair.threshold,currency);
  const max = pair.y==='habits'?100:pair.y==='mood'?5:Math.max(1,Number(pair.lower_average),Number(pair.upper_average));
  const measures = [
    [t('{0} от {1}',metrics[pair.x].label,threshold),pair.upper_average,'upper'],
    [t('{0} ниже {1}',metrics[pair.x].label,threshold),pair.lower_average,'lower'],
  ];
  const isSleep = pair.id==='sleep:habits';
  const to = isSleep ? '/modules/goals_habits?new=habit&preset=bedtime' :
    pair.id==='expenses:mood' ? routes.expenses+'?'+new URLSearchParams({currency,kind:'expense'}) : routes[pair.y];
  const label = isSleep ? t('Привычка «Сон до 23:30»') : pair.id==='expenses:mood'? t('Открыть траты'):t('Открыть записи');
  return <div id={'pair-'+pair.id} className={'life-card results-pair'+(featured?' results-pair-featured':'')}>
    <div className="results-pair-head"><div className="results-pair-chips">
      {[pair.x,pair.y].map((key,index)=><span className="results-pair-chip-item" key={key}>
        {index>0 && <small aria-hidden="true">×</small>}
        <Chip tone={metrics[key].theme}><ResultsIcon name={metrics[key].icon} size={12}/>{metrics[key].label}</Chip>
      </span>)}
      {pair.new&&<Chip tone="gold">{t('новое')}</Chip>}
    </div><IconButton icon="more" label={t('Основания сравнения')} onClick={onDetails}/></div>
    <h2>{observation(pair,currency)}</h2>
    <div className="results-measures">{measures.map(([name,value,group])=><div key={group}>
      <span>{name}</span><i aria-hidden="true"><b data-group={group} style={{width: Math.max(0,Math.min(100,Number(value)*100/max))+'%'}}/></i>
      <strong>{metricValue(pair.y,value,currency)}</strong>
    </div>)}</div>
    {featured && <div className="results-pair-history">
      <div className="results-pair-legend"><b>{t('{0} дней',days.length)}</b><span><i data-group="upper"/>{t('От порога')}</span>
        <span><i data-group="lower"/>{t('Ниже порога')}</span><span><i className="results-dot"/>{t('Есть второе значение')}</span></div>
      <div className="results-history-cells" style={{gridTemplateColumns:'repeat('+days.length+', minmax(0,1fr))'}}>
        {days.map(day=>{
          const record = pair.evidence.find(entry=>entry.day===day);
          const label = dayLabel(day) + ' · ' + (record ?
            metricValue(pair.x,record.x,currency)+' / '+metricValue(pair.y,record.y,currency):t('Нет данных'));
          return <span key={day} data-group={record?.group} title={label} aria-label={label}>{record&&<i/>}</span>;
        })}
      </div>
    </div>}
    <footer><p>{t('{0} и {1} дней в группах',pair.upper_days,pair.lower_days)}{featured?' · '+t('Наблюдение по вашим записям'):''}</p>
      <div><button type="button" className="results-text" disabled={disabled} onClick={onHide}>{t('Скрыть')}</button>
        <button type="button" className={featured&&isSleep?'results-button results-primary':'results-text'} onClick={()=>navigate(to)}>
          <ResultsIcon name={isSleep?'plus':'arrow'} size={14}/>{label}
        </button></div>
    </footer>
  </div>;
}

export function LinksView({data,span,modules,currency,timeZone,onSpan,onFilter,onHidden,navigate,error,waiting}:{
  data?:PairData;span:14|28;modules:string[]|null;currency:string;timeZone:string;
  onSpan:(span:14|28)=>void;onFilter:(modules:string[]|null,currency:string)=>void;
  onHidden:(id:string,hidden:boolean)=>Promise<void>;navigate:(to:string)=>void;error:string;waiting:boolean;
}) {
  const [filter,setFilter] = useState(false);
  const [draft,setDraft] = useState<string[]>([]);
  const [draftCurrency,setDraftCurrency] = useState(currency);
  const [evidence,setEvidence] = useState<Pair|null>(null);
  const [method,setMethod] = useState(false);
  const enabled = data?.available_modules??[];
  const found = data?.found??[];
  const collecting = data?.collecting??[];
  return <>
    <header className="results-heading">
      <div><div className="results-kicker">{t('Итоги')}</div><h1>{t('Связи')}</h1>
        <p>{t('Что идёт вместе в твоих данных — за последние {0} дней',span)}</p></div>
      <div className="results-heading-actions">
        <Segmented items={[[14,t('14 дней')],[28,t('28 дней')]] as const} value={span} onChange={onSpan} label={t('Период')}/>
        <button type="button" className="results-button" aria-haspopup="dialog" onClick={()=>{
          setDraft(modules??enabled);setDraftCurrency(currency);setFilter(true);
        }}><ResultsIcon name="filter"/>{t('Модули')} · {modules?.length??enabled.length}</button>
      </div>
    </header>
    <div className="results-links-chips">
      <Chip tone="gold"><ResultsIcon name="sparkles" size={13}/>{t('Найдено связей: {0}',found.length)}</Chip>
      <Chip><ResultsIcon name="clock" size={13}/>{t('Копят данные: {0}',collecting.length)}</Chip>
      {data && <Chip tone="outline">{data.updated_at?
        t('Обновлено {0}, {1}',dayLabel(data.day),clockLabel(data.updated_at,timeZone)):
        t('Расчёт на {0}',dayLabel(data.day))}</Chip>}
    </div>
    {error&&<p className="results-status" role="alert">{error}</p>}
    <div className="results-links-grid">
      {found.map((pair,index)=><PairCard key={pair.id} pair={pair} currency={currency} days={data?.days??[]}
        featured={index===0} navigate={navigate} onDetails={()=>setEvidence(pair)} disabled={waiting}
        onHide={()=>void onHidden(pair.id,true)}/>)}
      {data && !found.length && <LifeCard className="results-links-empty"><h2>{t('Пока нет найденных связей')}</h2>
        <p>{t('Продолжайте вносить записи. Связи появятся, когда накопится достаточно общих дней.')}</p></LifeCard>}
      <LifeCard className="results-collect" ><h2>{t('Копят данные')}</h2>
        <p>{t('Появятся, когда будет 8 общих дней')}</p>
        {collecting.map(pair=><div key={pair.id} id={'pair-'+pair.id} className="results-collect-row">
          <div><PairDots x={pair.x} y={pair.y}/><strong>{pairLabel(pair)}</strong><small>{t('{0} из 8 дней',Math.min(8,pair.n_days))}</small></div>
          <progress value={Math.min(8,pair.n_days)} max={8} aria-label={pairLabel(pair)}/>
          <footer><span>{pair.x==='steps'?t('Нужны данные устройства'):
            pair.needed>0?t('До первого сравнения — ещё {0} дн.',pair.needed):t('Нужно больше разных значений')}</span>
            {pair.x==='steps'&&<button className="results-button" onClick={()=>navigate(routes.steps)}>{t('Подключить')}</button>}
          </footer>
        </div>)}
        {data&&!collecting.length&&<p>{t('Для выбранных модулей нет пар, которые копят данные.')}</p>}
      </LifeCard>
    </div>
    <footer className="results-method"><ResultsIcon name="info" size={14}/>
      <span>{t('Как считаем: делим дни на две группы по медиане. Нужно от 8 общих дней и от 3 дней в группе.')}</span>
      <button className="results-text" type="button" onClick={()=>setMethod(true)}>{t('Подробнее')}<ResultsIcon name="arrow" size={14}/></button>
    </footer>
    {filter&&<Modal title={t('Модули')} onClose={()=>setFilter(false)} className="results-dialog">
      <div className="modal-body results-filter">
        {enabled.map(key=><label key={key}><input type="checkbox" checked={draft.includes(key)}
          onChange={event=>setDraft(current=>event.target.checked?[...current,key]:current.filter(item=>item!==key))}/>{moduleNames[key]}</label>)}
        {draft.includes('finance')&&<label>{t('Валюта')} <select value={draftCurrency} onChange={event=>setDraftCurrency(event.target.value)}>
          {currencyCodes(draftCurrency).map(code=><option key={code}>{code}</option>)}</select></label>}
        {!!data?.hidden.length&&<details><summary>{t('Скрытые связи')}</summary>
          {data.hidden.map(id=>{
            const [x,y]=id.split(':') as [Metric,Metric];
            return <button className="results-text" type="button" key={id} disabled={waiting} onClick={()=>void onHidden(id,false)}>
              {t('Снова показать: {0}',pairLabel({id,x,y}))}
            </button>;
          })}
        </details>}
      </div>
      <footer className="modal-footer"><button type="button" className="results-button" onClick={()=>{
        onFilter(null,draftCurrency);setFilter(false);
      }}>{t('Все модули')}</button><button type="button" className="results-button results-primary" disabled={!draft.length} onClick={()=>{
        onFilter(draft.length===enabled.length?null:draft,draftCurrency);setFilter(false);
      }}>{t('Применить')}</button></footer>
    </Modal>}
    {method&&<Modal title={t('Как считаем связи')} onClose={()=>setMethod(false)} className="results-dialog">
      <div className="modal-body"><p>{t('Сравниваются только даты, когда есть оба показателя. Дни делятся по вашей медиане на две группы. Нужно хотя бы 8 общих дней и по 3 дня в каждой группе.')}</p>
      <p>{t('Пропуски не считаются нулями. Связи описывают ваши записи и не устанавливают причины.')}</p></div>
    </Modal>}
    {evidence&&<Modal title={t('Основания сравнения')} onClose={()=>setEvidence(null)} className="results-dialog">
      <div className="modal-body results-evidence"><p>{pairLabel(evidence)} · {t('{0} дней',evidence.paired_days)}</p><table>
        <thead><tr><th scope="col">{t('Дата')}</th><th scope="col">{metrics[evidence.x].label}</th><th scope="col">{metrics[evidence.y].label}</th></tr></thead>
        <tbody>{evidence.evidence.map(record=><tr key={record.day}><td>{dayLabel(record.day)}</td>
          <td>{metricValue(evidence.x,record.x,currency)}</td><td>{metricValue(evidence.y,record.y,currency)}</td></tr>)}</tbody>
      </table></div>
    </Modal>}
  </>;
}
