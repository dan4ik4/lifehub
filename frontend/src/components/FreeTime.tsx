import { t } from '../lib/language';
import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {Clock3,Copy,Plus,Send,Settings2,Sparkles} from 'lucide-react';
import {openAssistant} from '../lib/workspace';
import {dateKey,dayLabel,shiftDay,timeText,todayKey,zonedISO} from '../lib/dates';
import type {CalendarRange,Notify,Task,User} from '../lib/types';
import {LifeCard} from './LifeCard';
import {Modal} from './ui';

const minute=60_000;
export type BusyInterval={start:number;end:number;title:string};
export type Window=BusyInterval&{kind:'free'|'busy'|'short'|'past'};
export function availableWindows(start:number,end:number,busy:BusyInterval[],minMinutes:number,bufferMinutes:number,now:number):Window[] {
  if (start>=end) return [];
  const next=Math.max(start,Math.min(end,Math.ceil(now/minute)*minute));
  const slots:Window[]=next>start?[{start,end:next,title:t("Прошло"),kind:'past'}]:[];
  const buffer=bufferMinutes*minute;
  const occupied=busy.filter(slot=>slot.end>=slot.start).map(slot=>({
    start:Math.max(next,slot.start-buffer),end:Math.min(end,slot.end+buffer),title:slot.title,
  })).filter(slot=>slot.end>slot.start).sort((a,b)=>a.start-b.start);
  const merged:BusyInterval[]=[];
  for(const slot of occupied){
    const previous=merged.at(-1);
    if(previous&&previous.end>=slot.start){
      previous.end=Math.max(previous.end,slot.end);
      if(slot.title!==previous.title)previous.title=t("Занято");
    }else merged.push(slot);
  }
  const pushFree=(a:number,b:number)=>{
    if(b>a)slots.push({start:a,end:b,title:t("Свободно"),kind:b-a>=minMinutes*minute?'free':'short'});
  };
  let cursor=next;
  for(const slot of merged){pushFree(cursor,slot.start);slots.push({...slot,kind:'busy'});cursor=slot.end;}
  pushFree(cursor,end);
  return slots;
}

export type SpanningTask = {start_at:string;end_at:string;title:string};

function occupiedByTask(startAt:string,endAt:string|null|undefined,title:string):BusyInterval {
  const start=Date.parse(startAt);
  return {start,end:Math.max(endAt?Date.parse(endAt):start,start+minute),title};
}

export function busyIntervals(calendar:Pick<CalendarRange,'tasks'|'events'>|null,tasks:Task[],spanningTasks:SpanningTask[]=[]):BusyInterval[] {
  const indexed=new Map(tasks.map(task=>[task.id,task]));
  return [
    ...(calendar?.events??[]).map(event=>({start:Date.parse(event.start_at),end:Date.parse(event.end_at),title:event.title})),
    ...spanningTasks.map(task=>occupiedByTask(task.start_at,task.end_at,task.title)),
    ...(calendar?.tasks??[]).flatMap(occ=>{
      const task=indexed.get(occ.task_id);
      const start=occ.effective_start_at??occ.effective_due_at;
      if(!task||task.all_day||occ.status!=='pending'||!start)return [];
      return [occupiedByTask(start,occ.effective_due_at,task.title)];
    }),
  ];
}
const hm=(minutes:number)=>[Math.floor(minutes/60)?Math.floor(minutes/60)+t(" ч"):'',minutes%60?minutes%60+t(" мин"):''].filter(Boolean).join(' ')||t("0 мин");
const length=(slot:BusyInterval)=>Math.floor((slot.end-slot.start)/minute);
export const readHours=(id:string)=>{
  const defaults={start:'08:00',end:'22:00',buffer:15};
  try{
    const value=JSON.parse(localStorage.getItem('lifehub.free-time.'+id)??'null');
    if(value&&[value.start,value.end].every(time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      &&value.start<value.end&&[0,5,10,15,30,60].includes(value.buffer))return value as typeof defaults;
  } catch {}
  return defaults;
};
const boundary=(day:string,time:string,zone:string)=>{
  const [hours,minutes]=time.split(':').map(Number);
  for(let delta=0;delta<=120;delta++){
    const value=hours*60+minutes+delta,clock=String(Math.floor((value%1440)/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
    try{return Date.parse(zonedISO(shiftDay(day,Math.floor(value/1440)),clock,zone));}catch{}
  }
  return NaN;
};
export function windowsForDay(day:string, timezone:string, busy:BusyInterval[], settings:ReturnType<typeof readHours>, minimum:number, now:number) {
  const start=boundary(day,settings.start,timezone),end=boundary(day,settings.end,timezone);
  const slots=availableWindows(start,end,busy,minimum,settings.buffer,now);
  const free=slots.filter(slot=>slot.kind==='free'),total=free.reduce((sum,slot)=>sum+length(slot),0);
  return {day,start,end,slots,free,total};
}

export function FreeTime({user,calendar,tasks,notify,onCreate}:{user:User;calendar:CalendarRange|null;tasks:Task[];notify:Notify;onCreate:(day:string,time:string,endTime:string)=>void}) {
  const [period,setPeriod]=useState(7);
  const [minimum,setMinimum]=useState(60);
  const [settings,setSettings]=useState(()=>readHours(user.id));
  const [draft,setDraft]=useState<typeof settings|null>(null);
  const [useBuffer,setUseBuffer]=useState(true);
  const [selected,setSelected]=useState<Window|null>(null);
  const [now,setNow]=useState(Date.now);
  const drag=useRef<{x:number;start:number}|null>(null);
  const blockClick=useRef(false);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  const timezone=user.timezone,today=todayKey(timezone);
  const busy=busyIntervals(calendar,tasks);
  const format=(time:number)=>timeText(new Date(time).toISOString(),timezone);
  const range=(slot:BusyInterval)=>format(slot.start)+'–'+format(slot.end);
  const label=(stamp:number)=>dayLabel(dateKey(new Date(stamp),timezone),{weekday:'short',day:'numeric',month:'short'});
  const rows=Array.from({length:period},(_,i)=>windowsForDay(shiftDay(today,i),timezone,busy,
    {...settings,buffer:useBuffer?settings.buffer:0},minimum,now));
  const slots=rows.flatMap(row=>row.free);
  const nearest=slots[0],best=rows.reduce((a,b)=>b.total>a.total?b:a);
  const share=slots.length?t("Я свободен:\n")+rows.filter(r=>r.free.length).map(row=>'• '+dayLabel(row.day,{weekday:'short',day:'numeric',month:'short'})+' — '+row.free.map(range).join(', ')).join('\n'):t("Нет свободных окон по выбранным условиям.");
  const copy=async(value:string)=>{
    try{await navigator.clipboard.writeText(value);notify(t("Скопировано"));}
    catch{notify(t("Не удалось скопировать. Выделите текст вручную."),'error');}
  };
  function slotTime(event:ReactPointerEvent<HTMLButtonElement>,slot:Window){
    const box=event.currentTarget.getBoundingClientRect(),position=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width));
    return Math.max(slot.start,Math.min(slot.end,Math.round((slot.start+(slot.end-slot.start)*position)/(5*minute))*5*minute));
  }
  return <div className="life-free">
    <header className="life-free-header"><div><span className="life-page-eyebrow">{t("Планирование")}</span><h1>{t("Свободное время")}</h1>
      <p>{t("По календарю и задачам со временем ·")} {settings.start}–{settings.end}</p></div><div>
        <button className="button secondary" onClick={()=>setDraft({...settings})}><Settings2 size={16}/>{t("Часы и буферы")}</button>
        <button className="button primary" onClick={()=>document.getElementById('free-share')?.scrollIntoView()}><Send size={16}/>{t("Поделиться")}</button>
      </div></header>
    <div className="life-free-controls">
      <div className="segmented" aria-label={t("Период")}>{[[1,t("Сегодня")],[7,t("7 дней")],[14,t("14 дней")]].map(([value,title])=><button key={value} aria-pressed={period===value} className={period===value?'selected':''} onClick={()=>{setPeriod(Number(value));setSelected(null);}}>{title}</button>)}</div>
      <div className="life-pills" aria-label={t("Минимальная длительность")}><span>{t("Окно не короче")}</span>
        {[[0,t("любое")],[30,t("30 мин")],[60,t("1 ч")],[120,t("2 ч")],[180,t("3 ч+")]].map(([value,title])=><button key={value} aria-pressed={minimum===value} onClick={()=>setMinimum(Number(value))}>{title}</button>)}
      </div>
      <label className="life-free-buffer"><input type="checkbox" checked={useBuffer} onChange={e=>setUseBuffer(e.target.checked)}/>{t("Буфер")} {settings.buffer} {t("мин")}</label>
    </div>
    {calendar&&<><div className="life-free-summary">
      <LifeCard className="life-nearest"><Clock3 size={26}/><div><small>{t("Ближайшее окно")}</small><h2>{nearest?label(nearest.start)+', '+range(nearest):t("Свободных окон нет")}</h2><p>{nearest?hm(length(nearest)):t("Попробуйте другой период или длительность.")}</p></div>
        {nearest&&<button className="button secondary" onClick={()=>void copy(label(nearest.start)+' · '+range(nearest))}>{t("Скопировать")}</button>}</LifeCard>
      <LifeCard><p>{t("Свободно")} {period===1?t("сегодня"):t("за ")+period+t(" дней")}</p><h2>{hm(rows.reduce((sum,row)=>sum+row.total,0))}</h2><p>{t("Подходящих окон:")} {slots.length}</p></LifeCard>
      <LifeCard><p>{t("Самый свободный день")}</p><h2>{best.total?dayLabel(best.day,{weekday:'long'}):'—'}</h2><p>{best.total?hm(best.total):t("Нет свободных окон")}</p></LifeCard>
    </div>
    <LifeCard className="life-free-chart"><header className="life-card-head"><div><h2>{period===1?t("Сегодня"):t("Период по дням")}</h2><p>{t("Нажмите на зелёный блок, чтобы занять или скопировать время.")}</p></div></header>
      <div className="life-timeline-scroll"><div className="life-free-axis"><span/><div>{Array.from({length:8},(_,i)=><small key={i}>{format(rows[0].start+(rows[0].end-rows[0].start)*i/7)}</small>)}</div><small>{t("Свободно")}</small></div>
      {rows.map(row=><div className="life-free-row" key={row.day}><strong className={row.day===today?'today':''}>{dayLabel(row.day,{weekday:'short',day:'numeric'})}</strong>
        <div className="life-free-lane">{row.slots.map(slot=>{
          const style={left:100*(slot.start-row.start)/(row.end-row.start)+'%',width:100*(slot.end-slot.start)/(row.end-row.start)+'%'};
          return slot.kind==='free'?<button className={'life-free-slot '+(slot===nearest?'nearest':'free')} style={style} key={slot.start}
            title={range(slot)+' · '+hm(length(slot))} aria-label={label(slot.start)+' '+range(slot)}
            onPointerDown={event=>{blockClick.current=false;if(event.pointerType==='mouse'&&event.button===0){drag.current={x:event.clientX,start:slotTime(event,slot)};event.currentTarget.setPointerCapture(event.pointerId);}}}
            onPointerCancel={()=>{drag.current=null;}}
            onPointerUp={event=>{
              const anchor=drag.current;drag.current=null;
              if(!anchor||Math.abs(anchor.x-event.clientX)<8)return;
              const to=slotTime(event,slot),start=Math.min(anchor.start,to),end=Math.max(anchor.start,to);
              if(end-start>=5*minute){blockClick.current=true;setSelected({...slot,start,end});}
            }}
            onClick={()=>{if(!blockClick.current)setSelected(slot);blockClick.current=false;}}>{hm(length(slot))}</button>
            :<span className={'life-free-slot '+slot.kind} style={style} key={slot.start} title={slot.title+' · '+range(slot)}>{slot.title}</span>;
        })}</div><small>{hm(row.total)}</small></div>)}</div>
    </LifeCard>
    <LifeCard className="life-share"><div id="free-share"><header className="life-card-head"><h2>{t("Поделиться")}</h2></header><p>{t("Текст по выбранному периоду и фильтрам.")}</p>
      <textarea readOnly value={share} aria-label={t("Текст со свободными окнами")} rows={6}/><button className="button primary" disabled={!slots.length} onClick={()=>void copy(share)}><Copy size={16}/>{t("Скопировать текст")}</button></div></LifeCard></>}
    {selected&&<Modal title={range(selected)} description={label(selected.start)+' · '+hm(length(selected))+t(" свободно")} onClose={()=>setSelected(null)}>
      <div className="modal-body life-slot-actions"><button className="button primary" onClick={()=>{onCreate(dateKey(new Date(selected.start),timezone),format(selected.start),format(selected.end));setSelected(null);}}><Plus size={16}/>{t("Занять время")}</button>
        <button className="button secondary" onClick={()=>void copy(label(selected.start)+' · '+range(selected))}><Copy size={16}/>{t("Скопировать")}</button>
        <button className="text-button" onClick={()=>{openAssistant(t("Помоги выбрать занятие на ")+label(selected.start)+t(" с ")+format(selected.start)+t(" до ")+format(selected.end)+'.');setSelected(null);}}><Sparkles size={16}/>{t("Спросить помощника")}</button></div></Modal>}
    {draft&&<Modal title={t("Часы и буферы")} onClose={()=>setDraft(null)}><form onSubmit={e=>{e.preventDefault();if(draft.start>=draft.end)return;setSettings(draft);try{localStorage.setItem('lifehub.free-time.'+user.id,JSON.stringify(draft));}catch{}setDraft(null);}}>
      <div className="modal-body product-form"><label>{t("Искать с")}<input type="time" required value={draft.start} onChange={e=>setDraft({...draft,start:e.target.value})}/></label>
        <label>{t("Искать до")}<input type="time" required value={draft.end} onChange={e=>setDraft({...draft,end:e.target.value})}/></label>
        <label>{t("Буфер до и после")}<select value={draft.buffer} onChange={e=>setDraft({...draft,buffer:Number(e.target.value)})}>{[0,5,10,15,30,60].map(value=><option value={value} key={value}>{value} {t("мин")}</option>)}</select></label>
        {draft.start>=draft.end&&<p role="alert">{t("Время окончания должно быть позже начала.")}</p>}</div>
      <footer className="modal-footer"><button className="button primary" disabled={draft.start>=draft.end}>{t("Сохранить")}</button></footer></form></Modal>}
  </div>;
}
