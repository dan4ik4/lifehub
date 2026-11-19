import {useEffect, useState} from 'react';
import {ArrowRight, Dumbbell, Footprints, Moon, Plus, Scale} from 'lucide-react';
import {api, errorMessage} from '../lib/api';
import {dayLabel, shiftDay, todayKey} from '../lib/dates';
import type {User} from '../lib/types';
import {openQuickAdd} from '../lib/workspace';
import {HealthConnection} from './HealthConnection';
import {formatAmount} from './format';
import {displayWeight, weightLabel} from './weight';
import type {Row} from './schema';

type Snapshot = {day:string;widgets:{
  sleep?:{hours:number;day?:string;end_at?:string;source?:string}|null;
  workouts?:{count:number;minutes:number};
  weight?:{day:string;kg:string}[];
  device_health?:{day:string;steps:number|null;provider:string}[];
}};

export function HealthOverview({user,navigate}: {user:User; navigate:(path:string)=>void}) {
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const [revision,reload]=useState(0);
  useEffect(() => {
    const change=() => reload(n => n+1);
    window.addEventListener('lifehub:data-changed',change);
    return () => window.removeEventListener('lifehub:data-changed',change);
  }, []);
  useEffect(() => {
    const controller=new AbortController();
    setError('');
    api<Snapshot>('/dashboard',{signal:controller.signal}).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    });
    return () => controller.abort();
  }, [user.id,revision]);
  const values=data?.widgets;
  const weight=values?.weight?.at(-1);
  const steps=values?.device_health?.filter(row => row.steps!==null)??[];
  const latestSteps=steps.at(-1);
  const sleepDay=values?.sleep?.day??(values?.sleep?.end_at ?
    new Date(values.sleep.end_at).toLocaleDateString('ru-RU',{timeZone:user.timezone,day:'numeric',month:'short'}) : null);
  const cards=[
    {key:'workouts', icon:Dumbbell, title:'Тренировки', value:values?.workouts ? formatAmount(values.workouts.minutes)+' мин' : '—',
      footer:values?.workouts ? 'За 7 дней · '+values.workouts.count : 'Последние 7 дней'},
    {key:'sleep', icon:Moon, title:'Сон', value:values?.sleep ? formatAmount(values.sleep.hours)+' ч' : '—',
      footer:sleepDay ? (sleepDay.includes('-')?dayLabel(sleepDay):sleepDay)+(values?.sleep?.source?' · с устройства':' · вручную') : 'Нет записи'},
    {key:'weight', icon:Scale, title:'Вес', value:weight ? formatAmount(displayWeight(weight.kg,user.weight_unit))+' '+weightLabel(user.weight_unit) : '—',
      footer:weight ? dayLabel(weight.day)+' · вручную' : 'Нет измерений'},
    {key:'overview#device-steps', icon:Footprints, title:'Шаги', value:latestSteps ? formatAmount(latestSteps.steps) : '—',
      footer:latestSteps ? dayLabel(latestSteps.day)+' · с устройства' : 'Нет данных устройства'},
  ];
  return <section className="hub-health-overview" aria-label="Обзор здоровья">
    <header className="section-toolbar">
      <h2>Последние показатели</h2>
      <button className="button primary" onClick={() => openQuickAdd('workouts')}><Plus size={17}/>Записать тренировку</button>
    </header>
    {error && <p role="alert" className="product-error">{error}<button className="text-button" onClick={() => reload(n=>n+1)}>Повторить</button></p>}
    {!data&&!error && <p className="product-loading" role="status">Загружаем показатели…</p>}
    <div className="hub-health-grid">{cards.map(({key,icon:Icon,title,value,footer}) => <button key={key}
      className="hub-health-metric" onClick={() => {
        if (key.includes('#')) {
          const details = document.getElementById('device-steps');
          if (details instanceof HTMLDetailsElement) {
            details.open = true;
            details.scrollIntoView({block:'start'});
          }
        } else navigate('/modules/health/'+key);
      }}>
      <span><Icon size={21}/>{title}<ArrowRight size={17}/></span>
      <strong>{value}</strong><small>{footer}</small>
    </button>)}</div>
    <details className="hub-disclosure" id="device-steps" open={Boolean(steps.length)}>
      <summary>Шаги и синхронизация</summary>
      {steps.length>0 && <div className="hub-steps-history">{steps.map(row => <div key={row.day}><time>{dayLabel(row.day)}</time><strong>{formatAmount(row.steps)}</strong><small>{row.provider==='apple_health'?'Apple Health':'Health Connect'}</small></div>)}</div>}
      <HealthConnection user={user}/>
    </details>
  </section>;
}

export function WorkoutActivity({user,revision,onSelect}: {user:User;revision:Row[];onSelect:(row:Row)=>void}) {
  const [days,setDays]=useState(7);
  const [metric,setMetric]=useState<'minutes'|'count'>('minutes');
  const [rows,setRows]=useState<Row[]>([]);
  const [active,setActive]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const today=todayKey(user.timezone);
  const start=shiftDay(today,1-days);
  const pro=user.plan==='pro'||(user.plan==='trial'&&!!user.trial_ends&&Date.parse(user.trial_ends)>Date.now());
  useEffect(() => {
    const controller=new AbortController();
    setLoading(true);
    setError('');
    api<{workouts:Row[]}>(`/health/summary?from=${start}&to=${today}`,{signal:controller.signal}).then(value => {
      if (!controller.signal.aborted) setRows(value.workouts??[]);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [start,today,revision]);
  const size=days===7?1:7;
  const groups=Array.from({length:Math.ceil(days/size)},(_,index) => {
    const from=shiftDay(start,index*size);
    const to=shiftDay(start,Math.min(days-1,(index+1)*size-1));
    const entries=rows.filter(row => String(row.day)>=from&&String(row.day)<=to);
    const minutes=entries.reduce((sum,row) => sum+Number(row.minutes),0);
    return {from,to,entries,count:entries.length,minutes};
  });
  const max=Math.max(1,...groups.map(group => group[metric]));
  const selected=groups.find(group => group.from===active);
  return <section className="health-chart workout-activity">
    <header><h3>Активность</h3>
      <label><span className="sr-only">Период тренировок</span><select value={days} onChange={event => {setActive(null);setDays(Number(event.target.value));}}>
        <option value={7}>7 дней</option><option value={30}>30 дней</option>{pro&&<option value={90}>90 дней</option>}
      </select></label>
    </header>
    {error ? <p className="field-error" role="alert">{error}</p> : loading ? <p role="status">Загружаем тренировки…</p> :
      !rows.length ? <p className="hub-muted">За этот период тренировок нет.</p> : <>
        <div className="workout-summary">
          <strong>{rows.length} <small>записей</small></strong>
          <strong>{rows.reduce((sum,row) => sum+Number(row.minutes),0)} <small>мин</small></strong>
          <div className="segmented" aria-label="Показатель тренировок" role="group">
            <button aria-pressed={metric==='minutes'} className={metric==='minutes'?'selected':''} onClick={() => setMetric('minutes')}>Минуты</button>
            <button aria-pressed={metric==='count'} className={metric==='count'?'selected':''} onClick={() => setMetric('count')}>Количество</button>
          </div>
        </div>
        <div className="workout-plot" aria-label="Тренировки по периодам">
          {groups.map(group => <button key={group.from} aria-pressed={active===group.from}
            aria-label={`${dayLabel(group.from)}${size>1?' — '+dayLabel(group.to):''} · ${group[metric]} ${metric==='minutes'?'мин':'записей'}`}
            onClick={() => setActive(current => current===group.from?null:group.from)}>
            <span className="workout-column"><i style={{height:group[metric]/max*100+'%'}}/></span>
            <small>{group.from.slice(-2)}</small>
          </button>)}
        </div>
        {selected && <div className="workout-drilldown">
          <h4>{dayLabel(selected.from)}{selected.to!==selected.from?' — '+dayLabel(selected.to):''}</h4>
          {selected.entries.length ? selected.entries.map(row => <button key={row.id} onClick={() => onSelect(row)}><span>{String(row.title)}</span><strong>{String(row.minutes)} мин</strong><ArrowRight size={14}/></button>) : <p>За эти даты записей нет.</p>}
        </div>}
      </>}
  </section>;
}
