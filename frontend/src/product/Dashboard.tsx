import {useCallback, useEffect, useId, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowRight, BookOpen, CalendarDays, Check, Heart, Moon, RefreshCw, Sparkles, Target, Wallet} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,plural} from '../lib/dates';
import type {Notify,User} from '../lib/types';
import {formatAmount} from './format';
import {displayWeight,weightLabel} from './weight';

type DayValue={day:string;hours:number|null};
type Habit={id:string;title:string;version:number;today_complete:boolean;target:string};
type DashboardData={day:string;modules:string[];widgets:{
  planning?:{tasks:{task:{id:string;title:string;version:number};occurrence:{status:string;occurrence_at:string|null}}[];events:{id:string;title:string;start_at:string;all_day:boolean}[]};
  habits?:Habit[];goals?:{id:string;title:string;progress:number}[];
  sleep?:{hours:number;end_at:string}|null;sleep_week?:DayValue[];
  device_health?:{day:string;steps:number|null;sleep_seconds:number|null}[];
  weight?:{day:string;kg:string}[];workouts?:{count:number;minutes:number};
  books?:{id:string;title:string;author:string;current_page:number;total_pages:number|null}[];
  finance?:{currency:string;kind:string;amount:string}[];
  budgets?:{id:string;category:string;currency:string;remaining:string;amount:string;percent:number}[];
}};
const number=(n:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
function Meter({value,label}:{value:number;label:string}){return <div className="overview-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamp(value)}><span style={{width:clamp(value)+'%'}}/></div>;}
function Widget({title,subtitle,icon,children,onOpen,className=''}:{title:string;subtitle:string;icon:ReactNode;children:ReactNode;onOpen:()=>void;className?:string}){
  return <section className={'overview-widget '+className}><header><div className="widget-heading"><span className="widget-icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div><button className="icon-button" aria-label={'Открыть: '+title} onClick={onOpen}><ArrowRight size={18}/></button></header><div className="widget-body">{children}</div></section>;
}
function Hint({children,onClick,label}:{children:ReactNode;onClick:()=>void;label:string}){return <div className="widget-empty"><p>{children}</p><button onClick={onClick}>{label}<ArrowRight size={15}/></button></div>;}

export function SleepChart({days}:{days:DayValue[]}){
  const id=useId(), [active,setActive]=useState<number|null>(null);
  const max=Math.max(10,...days.map(d=>d.hours||0)), width=480, height=145;
  const x=(i:number)=>18+i*(width-36)/Math.max(days.length-1,1), y=(n:number)=>height-14-n/max*(height-30);
  // Missing dates split the curve: no invented zeros or interpolation across unrecorded nights.
  const runs:{i:number;n:number}[][]=[];
  days.forEach((d,i)=>{if(d.hours===null)return;if(i===0||days[i-1].hours===null)runs.push([]);runs.at(-1)!.push({i,n:d.hours});});
  const curves=runs.map(run=>run.reduce((path,p,i)=>{if(!i)return `M${x(p.i)},${y(p.n)}`;const last=run[i-1],middle=(x(last.i)+x(p.i))/2;return path+` C${middle},${y(last.n)} ${middle},${y(p.n)} ${x(p.i)},${y(p.n)}`;},''));
  const chosen=active===null?null:days[active];
  return <div className="sleep-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={'Сон за неделю. '+days.map(d=>`${d.day}: ${d.hours===null?'нет записи':number(d.hours)+' ч'}`).join('; ')}><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#889db6" stopOpacity=".28"/><stop offset="100%" stopColor="#889db6" stopOpacity=".01"/></linearGradient></defs>{[4,8].map(n=><g key={n}><line x1="18" x2="462" y1={y(n)} y2={y(n)} stroke="#dde4e8" strokeDasharray="3 5"/><text x="2" y={y(n)-5} fontSize="10" fill="#657985">{n}ч</text></g>)}{runs.map((run,i)=><g key={i}><path d={curves[i]+` L${x(run.at(-1)!.i)},${height} L${x(run[0].i)},${height} Z`} fill={`url(#${id})`}/><path d={curves[i]} fill="none" stroke="#6e89a7" strokeWidth="3" strokeLinecap="round"/>{run.map(p=><circle key={p.i} cx={x(p.i)} cy={y(p.n)} r={p.i===active?6:4} fill="#f7fafc" stroke="#6e89a7" strokeWidth="2"/>)}</g>)}</svg><div className="chart-days">{days.map((d,i)=><button key={d.day} aria-label={`${dayLabel(d.day)}: ${d.hours===null?'нет записи':number(d.hours)+' часов'}`} aria-pressed={active===i} onClick={()=>setActive(active===i?null:i)}><span>{dayLabel(d.day,{weekday:'short'})}</span><strong>{d.hours===null?'—':number(d.hours)}</strong></button>)}</div><p className="chart-caption" aria-live="polite">{chosen?`${dayLabel(chosen.day)} · ${chosen.hours===null?'сон не записан':number(chosen.hours)+' ч сна'}`:'Нажмите на день, чтобы посмотреть запись'}</p></div>;
}

export function Dashboard({user,navigate,notify}:{user:User;navigate:(path:string)=>void;notify:Notify}){
  const [data,setData]=useState<DashboardData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[acting,setActing]=useState(''),[currency,setCurrency]=useState('');
  const controller=useRef<AbortController|null>(null), mutation=useRef(false);
  const refresh=useCallback(async()=>{controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setError('');try{const value=await api<DashboardData>('/dashboard',{signal:c.signal});if(!c.signal.aborted)setData(value);}catch(e){if(!c.signal.aborted)setError(errorMessage(e));}finally{if(!c.signal.aborted)setBusy(false);}},[]);
  useEffect(()=>{void refresh();const update=()=>void refresh();window.addEventListener('focus',update);window.addEventListener('lifehub:data-changed',update);return()=>{controller.current?.abort();window.removeEventListener('focus',update);window.removeEventListener('lifehub:data-changed',update);};},[refresh]);
  async function toggle(path:string,body:unknown,id:string){if(mutation.current)return;mutation.current=true;setActing(id);try{await api(path,{method:'POST',body});await refresh();}catch(e){notify(errorMessage(e),'error');await refresh();}finally{mutation.current=false;setActing('');}}
  const w=data?.widgets, plans=w?.planning, done=plans?.tasks.filter(t=>t.occurrence.status==='completed').length||0;
  const recorded=(w?.sleep_week||[]).filter((d):d is DayValue&{hours:number}=>d.hours!==null);
  const average=recorded.length?recorded.reduce((s,d)=>s+d.hours,0)/recorded.length:null;
  const currencies=[...new Set([...(w?.finance||[]).map(r=>r.currency),...(w?.budgets||[]).map(b=>b.currency)])];
  const selected=currencies.includes(currency)?currency:currencies[0];
  const income=w?.finance?.find(r=>r.currency===selected&&r.kind==='income')?.amount||'0',expense=w?.finance?.find(r=>r.currency===selected&&r.kind==='expense')?.amount||'0';
  const financeMax=Math.max(Number(income),Number(expense),1),weight=w?.weight?.at(-1);
  const go=(module:string)=>navigate('/modules/'+module);
  return <div className="home-overview">
    <section className="overview-hero"><div><span className="eyebrow"><span className="live-dot"/>{data?dayLabel(data.day,{weekday:'long',day:'numeric',month:'long'}):'ВАШ ЛИЧНЫЙ РИТМ'}</span><h2>Привет, {user.name?.split(' ')[0]||'друг'}.<br/><em>Всё важное — перед вами.</em></h2><p>Немного ясности для спокойного дня.</p><div className="hero-pills">{plans&&<span><CalendarDays size={14}/>{plural(plans.events.length,['событие','события','событий'])} сегодня</span>}{w?.habits&&<span><Target size={14}/>{w.habits.filter(h=>h.today_complete).length} / {w.habits.length} привычек</span>}</div></div><div className="hero-orbit" aria-hidden="true"><span/><span/><Sparkles size={36}/><i/></div><button className="icon-button hero-refresh" aria-label="Обновить сводку" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={18} className={busy?'spinner':''}/></button></section>
    {error&&<div className="product-error" role="alert">{error}<button className="button ghost" onClick={()=>void refresh()}>Попробовать снова</button></div>}
    {!data&&busy&&<div className="overview-grid skeleton-grid" aria-label="Загружаем сводку" aria-busy="true">{[1,2,3,4].map(i=><div key={i} className="overview-skeleton"/>)}</div>}
    <div className="overview-widgets">
      {plans&&<Widget title="План на сегодня" subtitle="Шаг за шагом, в своём темпе" icon={<CalendarDays size={20}/>} onOpen={()=>navigate('/planning')} className="plan-widget">
        <div className="plan-progress"><strong>{done}<span> / {plans.tasks.length} задач</span></strong><span>{plans.tasks.length?Math.round(done/plans.tasks.length*100):0}%</span></div><Meter value={plans.tasks.length?done/plans.tasks.length*100:0} label="Выполнено задач сегодня"/>
        {plans.events.length>0&&<div className="overview-agenda">{plans.events.slice(0,3).map(e=><button key={e.id+e.start_at} onClick={()=>navigate('/planning/calendar')}><time>{e.all_day?'Весь день':new Date(e.start_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:user.timezone})}</time><span>{e.title}</span><ArrowRight size={14}/></button>)}</div>}
        <div className="overview-tasks">{[...plans.tasks].sort((a,b)=>Number(a.occurrence.status==='completed')-Number(b.occurrence.status==='completed')).slice(0,4).map(({task,occurrence})=><button className="overview-check" key={task.id+occurrence.occurrence_at} role="checkbox" aria-checked={occurrence.status==='completed'} disabled={!!acting} onClick={()=>void toggle(`/planning/tasks/${task.id}/${occurrence.status==='completed'?'reopen':'complete'}`,{version:task.version,occurrence_at:occurrence.occurrence_at},task.id)}><span className={occurrence.status==='completed'?'done':''}>{occurrence.status==='completed'&&<Check size={13}/>}</span><span>{task.title}</span></button>)}</div>
        {!plans.tasks.length&&!plans.events.length?<Hint onClick={()=>navigate('/planning')} label="Составить план">Сегодня есть место для нового. Начните с одного важного дела.</Hint>:<button className="widget-link" onClick={()=>navigate('/planning')}>Весь день<ArrowRight size={15}/></button>}
      </Widget>}
      {w&&'sleep' in w&&<Widget title="Сон и восстановление" subtitle="Последние 7 дней" icon={<Moon size={20}/>} onOpen={()=>go('health')} className="sleep-widget"><div className="sleep-metrics"><div><small>В среднем за записанные дни</small><strong>{average===null?'—':number(average)}<span> ч</span></strong></div><div><small>Последняя запись</small><strong>{w.sleep?number(w.sleep.hours):'—'}<span> ч</span></strong></div></div><SleepChart days={w.sleep_week||[]}/>{!recorded.length&&<Hint onClick={()=>go('health')} label="Записать сон">Ваш ритм станет виден после первой записи.</Hint>}</Widget>}
      {w?.habits&&<Widget title="Цели и привычки" subtitle="Маленькие действия. Заметный прогресс." icon={<Target size={20}/>} onOpen={()=>go('goals_habits')}><div className="habits-summary"><strong>{w.habits.filter(h=>h.today_complete).length}<span> / {w.habits.length}</span></strong><span>привычек на сегодня</span></div>{w.habits.slice(0,4).map(h=><button className="overview-check" key={h.id} role="checkbox" aria-checked={h.today_complete} disabled={!!acting} onClick={()=>void toggle(`/habits/${h.id}/checkins`,{version:h.version,day:data!.day,value:h.today_complete?0:h.target},h.id)}><span className={h.today_complete?'done':''}>{h.today_complete&&<Check size={13}/>}</span><span>{h.title}</span></button>)}{w.goals?.slice(0,2).map(g=><button className="overview-goal" key={g.id} onClick={()=>go('goals_habits')}><span>{g.title}<b>{g.progress}%</b></span><Meter value={g.progress} label={g.title}/></button>)}{!w.habits.length&&!w.goals?.length&&<Hint onClick={()=>go('goals_habits')} label="Выбрать первый шаг">Добавьте привычку или цель, к которой хочется двигаться.</Hint>}</Widget>}
      {w?.finance&&<Widget title="Финансы" subtitle="Доходы и расходы с начала месяца" icon={<Wallet size={20}/>} onOpen={()=>go('finance')} className="money-widget">
        {currencies.length>1&&<label className="currency-choice">Валюта<select value={selected} onChange={e=>setCurrency(e.target.value)}>{currencies.map(c=><option key={c}>{c}</option>)}</select></label>}
        {selected?<><div className="money-primary"><small>Расходы</small><strong>{formatAmount(expense)}<span> {selected}</span></strong></div><div className="money-comparison">{[{label:'Доходы',value:income,kind:'income'},{label:'Расходы',value:expense,kind:'expense'}].map(row=><div key={row.kind} className={row.kind}><span>{row.label}<b>{formatAmount(row.value)} {selected}</b></span><Meter value={Number(row.value)/financeMax*100} label={row.label}/></div>)}</div>{w.budgets?.filter(b=>b.currency===selected).slice(0,2).map(b=><div className={'overview-budget '+(b.percent>100?'over':'')} key={b.id}><span>{b.category}<b>{b.percent}%</b></span><Meter value={b.percent} label={b.category}/><small>{Number(b.remaining)<0?'Превышение':'Осталось'}: {formatAmount(Number(b.remaining)<0?b.remaining.slice(1):b.remaining)} {selected}</small></div>)}</>:<Hint onClick={()=>go('finance')} label="Добавить операцию">Первый доход или расход — начало понятной картины.</Hint>}
      </Widget>}
      {w?.workouts&&<Widget title="Здоровье" subtitle="Как вы заботитесь о себе" icon={<Heart size={20}/>} onOpen={()=>go('health')} className="health-widget"><div className="health-stats"><div><span className="health-stat-icon"><Heart size={18}/></span><strong>{w.workouts.count}<small> за неделю</small></strong><p>Тренировки · {w.workouts.minutes} минут</p></div><div><span className="health-stat-icon">↗</span><strong>{weight?number(displayWeight(weight.kg,user.weight_unit)):'—'}<small> {weightLabel(user.weight_unit)}</small></strong><p>{weight?'Вес · '+dayLabel(weight.day):'Вес пока не записан'}</p></div></div><button className="widget-link" onClick={()=>go('health')}>Показатели и записи<ArrowRight size={15}/></button></Widget>}
      {!!w?.device_health?.length&&<Widget title="Шаги" subtitle="Сегодня · с телефона" icon={<Heart size={20}/>} onOpen={()=>go('health')}><div className="sleep-metrics"><div><strong>{w.device_health.find(d=>d.day===data?.day)?.steps?.toLocaleString('ru-RU')??'—'}</strong><small>шагов за день</small></div></div><button className="widget-link" onClick={()=>go('health')}>Данные здоровья<ArrowRight size={15}/></button></Widget>}
      {w?.books&&<Widget title="Сейчас читаю" subtitle="Немного времени для себя" icon={<BookOpen size={20}/>} onOpen={()=>go('books')} className="reading-widget">{w.books.length?w.books.slice(0,2).map(b=><button className="overview-book" key={b.id} onClick={()=>go('books')}><span className="book-cover" aria-hidden="true"><BookOpen size={25}/><span>lifehub<br/>reading</span></span><span className="book-info"><strong>{b.title}</strong><small>{b.author||'Ваша книжная полка'}</small><Meter value={b.total_pages?b.current_page/b.total_pages*100:0} label={'Прогресс чтения '+b.title}/><span>{b.current_page} / {b.total_pages||'—'} страниц</span></span></button>):<Hint onClick={()=>go('books')} label="Найти книгу">История, к которой приятно возвращаться. Что читаете сейчас?</Hint>}</Widget>}
    </div>
  </div>;
}
