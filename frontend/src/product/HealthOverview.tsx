import {LifeBars,LifeCard,LifeLink,LifeRings} from '../components/LifeCard';
import {HealthChart} from './Extras';
import {openWorkout} from './WorkoutSession';
import {storeWeight} from './weight';
import {refreshWorkspace} from '../lib/workspace';
import {useEffect, useState} from 'react';
import {ArrowRight, Dumbbell, Footprints, Moon, Plus, Scale} from 'lucide-react';
import {api, errorMessage} from '../lib/api';
import {dateKey,dayLabel,shiftDay,timeText,todayKey,zonedISO} from '../lib/dates';
import type {User} from '../lib/types';
import {openQuickAdd} from '../lib/workspace';
import {HealthConnection} from './HealthConnection';
import {formatAmount} from './format';
import {displayWeight, weightLabel} from './weight';
import type {Row} from './schema';

type Snapshot = {day:string;widgets:{
  sleep?:{hours:number;day?:string;end_at?:string;source?:string}|null;
  sleep_week?:{day:string;hours:number|null}[];
  workouts?:{count:number;minutes:number};
  weight?:{day:string;kg:string}[];
  device_health?:{day:string;steps:number|null;provider:string}[];
}};

const emptyHistory:Row[]=[];
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
  const historyVersion=(values?.weight??emptyHistory) as Row[];
  const weight=values?.weight?.at(-1);
  const steps=values?.device_health?.filter(row => row.steps!==null)??[];
  const latestSteps=steps.at(-1);
  const [weightInput,setWeightInput]=useState(''),[weightBusy,setWeightBusy]=useState(false),[weightStatus,setWeightStatus]=useState('');
  const sleepDay=values?.sleep?.day??(values?.sleep?.end_at ?
    new Date(values.sleep.end_at).toLocaleDateString('ru-RU',{timeZone:user.timezone,day:'numeric',month:'short'}) : null);
  const cards=[
    {key:'workouts', icon:Dumbbell, title:'Тренировки', value:values?.workouts ? formatAmount(values.workouts.minutes)+' мин' : '—',
      footer:values?.workouts ? 'За 7 дней · '+values.workouts.count : 'Последние 7 дней'},
    {key:'sleep', icon:Moon, title:'Сон', value:values?.sleep ? Math.floor(Math.round(values.sleep.hours*60)/60)+':'+String(Math.round(values.sleep.hours*60)%60).padStart(2,'0')+' ч' : '—',
      footer:sleepDay ? (sleepDay.includes('-')?dayLabel(sleepDay):sleepDay)+(values?.sleep?.source?' · с устройства':' · вручную') : 'Нет записи'},
    {key:'weight', icon:Scale, title:'Вес', value:weight ? formatAmount(displayWeight(weight.kg,user.weight_unit))+' '+weightLabel(user.weight_unit) : '—',
      footer:weight ? dayLabel(weight.day)+' · вручную' : 'Нет измерений'},
    {key:'overview#device-steps', icon:Footprints, title:'Шаги', value:latestSteps ? formatAmount(latestSteps.steps) : '—',
      footer:latestSteps ? dayLabel(latestSteps.day)+' · с устройства' : 'Нет данных устройства'},
  ];
  return <section className="hub-health-overview" aria-label="Обзор здоровья">
    {error && <p role="alert" className="product-error">{error}<button className="text-button" onClick={() => reload(n=>n+1)}>Повторить</button></p>}
    {!data&&!error && <p className="product-loading" role="status">Загружаем показатели…</p>}
    <div className="hub-health-grid">{[cards[1],cards[2],cards[0],cards[3]].map(({key,icon:Icon,title,value,footer}) => <button key={key}
      className={'hub-health-metric life-metric theme-'+(key==='sleep'?'plans':key.includes('#')?'habits':'health')} onClick={() => {
        if (key.includes('#')) {
          const details = document.getElementById('device-steps');
          if (details instanceof HTMLDetailsElement) {
            details.open = true;
            details.scrollIntoView({block:'start'});
          }
        } else navigate('/modules/health/'+key);
      }}>
      <span className="life-metric-heading"><span><Icon size={17}/></span>{title}<ArrowRight size={15}/></span>
      {key==='sleep'&&values?.sleep_week&&<LifeBars values={values.sleep_week.map(row=>row.hours)} format={v=>formatAmount(v)+' ч'}/>}
      {key==='weight'&&values?.weight&&<LifeBars values={values.weight.map(row=>displayWeight(row.kg,user.weight_unit))} format={v=>formatAmount(v)+' '+weightLabel(user.weight_unit)}/>}
      <strong>{value}</strong><small>{footer}</small>
    </button>)}</div>
    <div className="life-health-panels">
      <div className="life-health-weight"><HealthChart section="weight" user={user} revision={historyVersion}/>
        <form className="life-weight-inline" onSubmit={async e=>{e.preventDefault();if(weightBusy||!weightInput)return;setWeightBusy(true);setWeightStatus('');
          try{await api('/health/weight',{method:'POST',body:{day:todayKey(user.timezone),kg:storeWeight(weightInput,user.weight_unit)}});setWeightInput('');setWeightStatus('Вес сохранён');refreshWorkspace();}
          catch(cause){setWeightStatus(errorMessage(cause));}finally{setWeightBusy(false);}}}>
          <label>Записать вес за сегодня <input aria-label={'Вес, '+weightLabel(user.weight_unit)} type="number" min="0.1" step=".1" required value={weightInput} placeholder={weight?formatAmount(displayWeight(weight.kg,user.weight_unit)):'—'} onChange={e=>setWeightInput(e.target.value)}/></label>
          <button className="button primary life-brown-button" disabled={weightBusy||!weightInput}>Сохранить</button>
          {weightStatus&&<small role="status">{weightStatus}</small>}</form>
      </div>
      <LifeCard className="life-health-workout"><header className="life-card-head"><div><h3>Тренировки</h3><p>{values?.workouts?.minutes??0} мин за последние 7 дней</p></div>
        <LifeLink action={()=>navigate('/modules/health/workouts')}>Все</LifeLink></header>
        <WorkoutActivity user={user} revision={historyVersion} compact onSelect={row=>navigate('/modules/health/workouts/'+row.id)}/>
        <button className="button primary life-brown-button" onClick={()=>openWorkout()}>Начать тренировку</button>
      </LifeCard>
      <SleepRhythm user={user} revision={historyVersion}/>
      <LifeCard className="life-health-meds"><header className="life-card-head"><div><h3>Сегодня принять</h3><p>Запланированные приёмы и отметки</p></div><LifeLink action={()=>navigate('/modules/health/medications')}>Лекарства</LifeLink></header>
        <MedicationToday user={user} revision={historyVersion}/></LifeCard>
    </div>
    <details className="hub-disclosure" id="device-steps" open={Boolean(steps.length)}>
      <summary>Шаги и синхронизация</summary>
      {steps.length>0 && <div className="hub-steps-history">{steps.map(row => <div key={row.day}><time>{dayLabel(row.day)}</time><strong>{formatAmount(row.steps)}</strong><small>{row.provider==='apple_health'?'Apple Health':'Health Connect'}</small></div>)}</div>}
      <HealthConnection user={user}/>
    </details>
  </section>;
}

function SleepRhythm({user,revision}:{user:User;revision:unknown}){
  const [days,setDays]=useState(7),[rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const today=todayKey(user.timezone),start=shiftDay(today,1-days),zone=user.timezone;
  const pro=user.plan==='pro'||(user.plan==='trial'&&Date.parse(user.trial_ends??'')>Date.now());
  useEffect(()=>{
    const controller=new AbortController(),signal=controller.signal;
    setError('');setLoading(true);
    api<{sleep:Row[]}>('/health/summary?'+new URLSearchParams({from:start,to:today}),{signal})
      .then(result=>{if(!signal.aborted)setRows(result.sleep);})
      .catch(cause=>{if(!signal.aborted)setError(errorMessage(cause));})
      .finally(()=>{if(!signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[start,today,revision]);
  const chart=Array.from({length:days},(_,index)=>shiftDay(start,index)).slice(-Math.min(14,days));
  function bars(key:string){
    const axisStart=Date.parse(zonedISO(shiftDay(key,-1),'20:00',zone)),axisEnd=Date.parse(zonedISO(key,'12:00',zone));
    const localRows=rows.filter(row=>dateKey(String(row.end_at),zone)===key);
    const total=localRows.reduce((sum,row)=>sum+Number(row.hours),0);
    return {total,slots:localRows.flatMap(row=>{
      const start=Date.parse(String(row.start_at)),end=Date.parse(String(row.end_at));
      const left=Math.max(0,100*(start-axisStart)/(axisEnd-axisStart)),right=Math.min(100,100*(end-axisStart)/(axisEnd-axisStart));
      return right>left?[{left,width:right-left,label:timeText(String(row.start_at),zone)+'–'+timeText(String(row.end_at),zone)}]:[];
    })};
  }
  return <LifeCard className="life-sleep-rhythm"><header className="life-card-head"><div><h3>Ритм сна</h3><p>Время сна по ручным записям</p></div>
    <div className="segmented">{[7,30,...(pro?[90]:[])].map(value=><button key={value} aria-pressed={days===value} className={days===value?'selected':''} onClick={()=>setDays(value)}>{value} д</button>)}</div></header>
    {error?<p role="alert">{error}</p>:loading?<p role="status">Загружаю ритм сна…</p>:<>
      {rows.length>0&&<div className="life-sleep-axis"><span>20:00</span><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span></div>}
      {chart.map(key=>{const value=bars(key);return <div className="life-sleep-row" key={key}><time>{dayLabel(key,{day:'numeric',month:'short'})}</time>
        <span className="life-sleep-lane" aria-label={value.slots.map(slot=>slot.label).join(', ')||'Нет записи'}>{value.slots.map((slot,index)=><i key={index} style={{left:slot.left+'%',width:slot.width+'%'}} title={slot.label}/>)}</span>
        <strong>{value.total?formatAmount(value.total)+' ч':'—'}</strong></div>;})}
      {days>14&&<details className="hub-disclosure"><summary>Весь период · {rows.length} записей</summary>
        <ul>{rows.map(row=><li key={row.id}>{dayLabel(dateKey(String(row.end_at),zone))} · {timeText(String(row.start_at),zone)}–{timeText(String(row.end_at),zone)}</li>)}</ul></details>}
    </>}
  </LifeCard>;
}

export function WorkoutActivity({user,revision,onSelect,compact=false}: {user:User;revision:unknown;onSelect:(row:Row)=>void;compact?:boolean}) {
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
  const duration=rows.reduce((sum,row)=>sum+Number(row.minutes),0);
  const tonnage=rows.reduce((sum,row)=>sum+(Array.isArray(row.efforts)?row.efforts.reduce((n,effort)=>n+Number(effort.kg??0)*Number(effort.reps),0):0),0);
  const selected=groups.find(group => group.from===active);
  return <section className="health-chart workout-activity">
    {!compact&&<header><h3>Активность</h3>
      <label><span className="sr-only">Период тренировок</span><select value={days} onChange={event => {setActive(null);setDays(Number(event.target.value));}}>
        <option value={7}>7 дней</option><option value={30}>30 дней</option>{pro&&<option value={90}>90 дней</option>}
      </select></label>
    </header>}
    {error ? <p className="field-error" role="alert">{error}</p> : loading ? <p role="status">Загружаем тренировки…</p> :
      !rows.length ? <p className="hub-muted">За этот период тренировок нет.</p> : <>
        {!compact&&<div className="life-workout-kpis">
          <LifeRings size={60} label={duration+' мин из 150'} values={[{value:duration/150,color:'#895934',track:'#f3e4d6'}]}/>
          <div><small>Длительность</small><strong>{duration} мин</strong></div><div><small>Тоннаж</small><strong>{tonnage?formatAmount(tonnage)+' кг':'—'}</strong></div><div><small>Средняя длительность</small><strong>{Math.round(duration/rows.length)} мин</strong></div>
        </div>}
        {!compact&&<div className="workout-summary">
          <strong>{rows.length} <small>записей</small></strong>
          <strong>{rows.reduce((sum,row) => sum+Number(row.minutes),0)} <small>мин</small></strong>
          <div className="segmented" aria-label="Показатель тренировок" role="group">
            <button aria-pressed={metric==='minutes'} className={metric==='minutes'?'selected':''} onClick={() => setMetric('minutes')}>Минуты</button>
            <button aria-pressed={metric==='count'} className={metric==='count'?'selected':''} onClick={() => setMetric('count')}>Количество</button>
          </div>
        </div>}
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

function MedicationToday({user,revision}:{user:User;revision:unknown}){
  const [items,setItems]=useState<{row:Row;time:string;taken:boolean}[]>([]),[error,setError]=useState(''),[pending,setPending]=useState(false),[update,refresh]=useState(0);
  const pro=user.plan==='pro'||(user.plan==='trial'&&Date.parse(user.trial_ends??'')>Date.now());
  const day=todayKey(user.timezone);
  useEffect(()=>{
    if(!pro)return;
    const c=new AbortController(),signal=c.signal;
    setError('');
    (async()=>{
      try{
        const result=await api<{items:Row[]}>('/health/medications?limit=20',{signal});
        const rows=await Promise.all(result.items.map(async row=>{
          const response=await api<{items:Row[]}>(`/health/medications/${row.id}/intakes?day=${day}`,{signal});
          const marked=new Set(response.items.map(item=>String(item.time)));
          return (Array.isArray(row.times)?row.times as string[]:[]).map(time=>({row,time,taken:marked.has(time)}));
        }));
        if(!signal.aborted)setItems(rows.flat().sort((a,b)=>a.time.localeCompare(b.time)));
      }catch(cause){if(!signal.aborted)setError(errorMessage(cause));}
    })();
    return ()=>c.abort();
  },[day,pro,revision,update]);
  if(!pro)return <p>Отметки приёмов доступны в Pro.</p>;
  return <>{error&&<p role="alert">{error}</p>}{!items.length&&!error&&<p>Приёмы пока не запланированы.</p>}
    {items.slice(0,5).map(({row,time,taken})=><button className="life-medication-item" key={row.id+time} disabled={pending} aria-pressed={taken}
      onClick={async()=>{setPending(true);try{await api('/health/medications/'+row.id+'/intakes',{method:'POST',body:{day,time,taken:!taken,version:row.version}});
        setItems(old=>old.map(item=>item.row.id===row.id&&item.time===time?{...item,taken:!taken}:item));refresh(value=>value+1);
      }catch(cause){setError(errorMessage(cause));}finally{setPending(false);}}}>
      <span className="life-task-check" aria-checked={taken}>{taken?'✓':''}</span><span><strong>{String(row.title)}</strong><small>{time}</small></span>
    </button>)}</>;
}
