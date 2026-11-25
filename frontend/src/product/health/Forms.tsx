import {useState} from 'react';
import type {ReactNode} from 'react';
import {Modal} from '../../components/ui';
import {errorMessage} from '../../lib/api';
import {dateKey,dayLabel,parts,shiftDay,todayKey,zonedISO} from '../../lib/dates';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {formatAmount} from '../format';
import {displayWeight,storeWeight,weightLabel} from '../weight';
import {decimalWeight,healthMeals,HealthSegment,HIcon,macroNames,saveHealth,signed,wallClock,zeroMacros} from './shared';
import type {Food,FoodGoal,Macros,Meal,Medication,Sleep,Weight,WeightGoal} from './shared';

export const sleepQuality=[t('Очень плохо'),t('Плохо'),t('Нормально'),t('Хорошо'),t('Отлично')];
export const weekdays=Array.from({length:7},(_,i)=>dayLabel(shiftDay('2026-11-23',i),{weekday:'short'}));
type Common={user:User;onClose:()=>void;onSaved:()=>void};
type Fields={title:string;description?:string;night?:boolean;action?:string;children:ReactNode;onRun:()=>Promise<void>;onClose:()=>void};
function HealthForm({title,description,night,children,action=t('Сохранить'),onRun,onClose}:Fields) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={title} description={description} className={'health-modal'+(night?' health-night':'')} onClose={()=>{if(!busy)onClose();}}>
    <form className="health-editor" onSubmit={async event=>{
      event.preventDefault();if(busy)return;
      setBusy(true);setError('');
      try{await onRun();}catch(cause){setError(errorMessage(cause));}
      finally{setBusy(false);}
    }}>
      <fieldset disabled={busy} className="health-fields">{children}</fieldset>
      {error&&<p role="alert" className="health-error">{error}</p>}
      <footer className="health-form-footer">
        <button type="button" className="health-button" disabled={busy} onClick={onClose}>{t('Отмена')}</button>
        <button className="health-button health-primary" disabled={busy}>{busy?t('Сохранение…'):action}</button>
      </footer>
    </form>
  </Modal>;
}

const maxSleep = 48 * 60;
export function SleepForm({user,onSaved,onClose,row}:Common&{row?:Sleep}) {
  const zone=user.timezone, today=todayKey(zone), now=parts(new Date(),zone);
  const initialTime=(stamp?:string)=>stamp?parts(stamp,zone):null;
  const start=initialTime(row?.start_at), end=initialTime(row?.end_at);
  const [day,setDay]=useState(row?dateKey(row.start_at,zone):shiftDay(today,-1));
  const [bed,setBed]=useState(start?start.hour+':'+start.minute:'23:30');
  const [wake,setWake]=useState(end?end.hour+':'+end.minute:(Number(now.hour)<7?now.hour+':'+now.minute:'07:00'));
  const [explicitEnd,setExplicitEnd]=useState(row&&dateKey(row.end_at,zone)!==(wake<=bed?shiftDay(day,1):day)?dateKey(row.end_at,zone):null);
  const [quality,setQuality]=useState(row?.quality??3);
  const wakeDay=explicitEnd??(wake<=bed&&day?shiftDay(day,1):day);
  const interval=()=>{
    if(!day||!wakeDay||!bed||!wake)throw new Error(t('Укажите дату и время сна.'));
    const start_at=zonedISO(day,bed,zone),end_at=zonedISO(wakeDay,wake,zone);
    const minutes=(Date.parse(end_at)-Date.parse(start_at))/60000;
    if(minutes<=0||minutes>maxSleep)throw new Error(t('Проверьте время сна и пробуждения.'));
    return {start_at,end_at,minutes};
  };
  let duration='—';
  try{const minutes=interval().minutes;duration=t('{0} ч {1} мин',Math.floor(minutes/60),minutes%60);}catch{}
  return <HealthForm title={row?t('Изменить запись сна'):t('Записать сон')} night description={t('Часовой пояс аккаунта · {0}',zone)}
    onClose={onClose} onRun={async()=>{
      const {start_at,end_at}=interval();
      if(Date.parse(end_at)>Date.now())throw new Error(t('Время пробуждения должно быть в прошлом.'));
      await saveHealth('/health/sleep',{start_at,end_at,quality},row);onSaved();
    }}>
    <div className="health-field"><span id="health-bed-label">{t('Заснул')}</span><div className="health-time-pair">
      <label className="health-date-field"><HIcon name="calendar" size={15}/><input aria-label={t('Дата отбоя')} required type="date" max={today} value={day}
        onChange={event=>{setDay(event.target.value);setExplicitEnd(null);}}/></label>
      <input type="time" required aria-label={t('Время отбоя')} value={bed} onChange={event=>{setBed(event.target.value);setExplicitEnd(null);}}/>
    </div></div>
    <div className="health-field"><span>{t('Проснулся')}</span><div className="health-time-pair">
      <label className="health-date-field"><HIcon name="calendar" size={15}/><input aria-label={t('Дата пробуждения')} required type="date" max={today} value={wakeDay}
        onChange={event=>setExplicitEnd(event.target.value)}/></label>
      <input type="time" required aria-label={t('Время пробуждения')} value={wake} onChange={event=>setWake(event.target.value)}/>
    </div></div>
    <div className="health-callout"><HIcon name="moon"/><span>{t('Продолжительность')}</span><strong>{duration}</strong></div>
    <fieldset className="health-quality-form"><legend>{t('Как спалось?')}</legend><div>
      {sleepQuality.map((label,index)=><button type="button" key={label} aria-pressed={quality===index+1} onClick={()=>setQuality(index+1)}>
        <b>{index+1}</b><small>{label}</small></button>)}
    </div></fieldset>
  </HealthForm>;
}

export function WeightStepper({value,onChange,unit,label,step=0.1}:{value:string;onChange:(value:string)=>void;unit:string;label:string;step?:number}) {
  const change=(amount:number)=>onChange(decimalWeight(Math.max(0.1,(Number(value.replace(',','.'))||0)+amount)));
  return <div className="health-stepper">
    <button type="button" aria-label={t('Уменьшить вес')} onClick={()=>change(-step)}>−</button>
    <input type="text" inputMode="decimal" aria-label={label} value={value} onChange={event=>onChange(event.target.value)}/>
    <span>{unit}</span><button type="button" aria-label={t('Увеличить вес')} onClick={()=>change(step)}><HIcon name="plus" size={20}/></button>
  </div>;
}

export function WeightForm({user,row,prior,goal,onClose,onSaved}:Common&{row?:Weight;prior?:Weight;goal?:WeightGoal}) {
  const today=todayKey(user.timezone), yesterday=shiftDay(today,-1),unit=weightLabel(user.weight_unit);
  const initial=row??prior;
  const [value,setValue]=useState(initial?decimalWeight(displayWeight(initial.kg,user.weight_unit)):'');
  const [day,setDay]=useState(row?.day??today);
  const [dateMode,setDateMode]=useState(row&&row.day!==today&&row.day!==yesterday?'custom':row?.day===yesterday?'yesterday':'today');
  const [notes,setNotes]=useState(row?.notes??'');
  const kg=Number(value.replace(',','.'));
  return <HealthForm title={row?t('Изменить измерение'):t('Записать вес')} onClose={onClose} onRun={async()=>{
    if(!Number.isFinite(kg)||kg<=0||kg>displayWeight(1000,user.weight_unit))throw new Error(t('Введите допустимый вес.'));
    if(!day||day>today)throw new Error(t('Выберите сегодняшнюю или прошедшую дату.'));
    await saveHealth('/health/weight',{day,kg:storeWeight(kg,user.weight_unit),notes:notes.trim()},row);onSaved();
  }}>
    <div className="health-stepper-box"><WeightStepper value={value} onChange={setValue} unit={unit} label={t('Вес')}/></div>
    <p className="health-muted">{t('Шаг 0,1 {0} · можно ввести с клавиатуры',unit)}</p>
    <HealthSegment value={dateMode} onSelect={mode=>{setDateMode(mode);if(mode!=='custom')setDay(mode==='today'?today:yesterday);}}
      choices={ [['today',t('Сегодня')],['yesterday',t('Вчера')],['custom',t('Дата')]] as const} label={t('Дата измерения')}/>
    {dateMode==='custom'&&<label className="health-field">{t('Дата измерения')}<input type="date" required max={today} value={day} onChange={e=>setDay(e.target.value)}/></label>}
    <label className="health-field">{t('Заметка')}<input maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder={t('Например, утром натощак')}/></label>
    {kg>0&&(prior||goal)&&<div className="health-callout"><HIcon name="trend"/>
      <span>{[prior&&t('{0} {1} к прошлому',signed(kg-displayWeight(prior.kg,user.weight_unit)),unit),
        goal&&t('До цели {0} {1}',formatAmount(Math.abs(displayWeight(goal.kg,user.weight_unit)-kg)),unit)].filter(Boolean).join(' · ')}</span></div>}
  </HealthForm>;
}

export function FoodForm({user,row,meal,day,onClose,onSaved}:Common&{row?:Food;meal?:Meal;day?:string}) {
  const [selected,setSelected]=useState<Meal>(row?.meal??meal??'breakfast');
  const [title,setTitle]=useState(row?.title??'');
  const [fields,setFields]=useState<Record<keyof Macros,string>>({calories:row?.calories??'',protein:row?.protein??'',fat:row?.fat??'',carbs:row?.carbs??''});
  const number=(key:keyof Macros)=>Number(fields[key].replace(',','.'));
  const input=(key:keyof Macros,required=false)=><label className="health-field">{macroNames[key]}<span className={'health-unit-field'+(required?' health-calorie-input':'')}>
    <input aria-label={macroNames[key]} type="number" inputMode="decimal" min="0" max={required?100000:10000} step="0.01" required={required}
      value={fields[key]} onChange={e=>setFields(old=>({...old,[key]:e.target.value}))}/><small>{required?t('ккал'):t('г')}</small></span>
  </label>;
  return <HealthForm title={row?t('Изменить приём пищи'):t('Добавить еду')} action={row?t('Сохранить'):t('Добавить')} onClose={onClose}
    onRun={async()=>{
      if(!title.trim())throw new Error(t('Укажите, что ели.'));
      await saveHealth('/health/nutrition',{day:row?.day??day??todayKey(user.timezone),meal:selected,title:title.trim(),
        calories:number('calories'),protein:number('protein'),fat:number('fat'),carbs:number('carbs')},row);onSaved();
    }}>
    <HealthSegment choices={healthMeals.map(([key,label])=>[key,label] as const)} value={selected} onSelect={setSelected} label={t('Приём пищи')}/>
    <label className="health-field">{t('Что ели')}<input required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    {input('calories',true)}
    <div className="health-macro-fields">{input('protein')}{input('fat')}{input('carbs')}</div>
    <p className="health-muted">{t('Макросы необязательны')}</p>
  </HealthForm>;
}

export function FoodGoalForm({row,onClose,onSaved}:{row?:FoodGoal;onClose:()=>void;onSaved:()=>void}) {
  const [targets,setTargets]=useState<Macros>(row??zeroMacros);
  return <HealthForm title={t('Ориентиры питания')} description={t('Укажите свои дневные ориентиры. Ноль отключает ориентир.')} onClose={onClose}
    onRun={async()=>{const {calories,protein,fat,carbs}=targets;await saveHealth('/health/nutrition-targets',{calories,protein,fat,carbs},row);onSaved();}}>
    {(Object.keys(macroNames) as Array<keyof Macros>).map(key=><label key={key} className="health-field">{macroNames[key]}
      <input type="number" required min={0} max={key==='calories'?100000:10000} value={targets[key]} onChange={e=>setTargets(old=>({...old,[key]:Number(e.target.value)}))}/>
    </label>)}
  </HealthForm>;
}

export function MedicationForm({row,onClose,onSaved,onDelete}:Common&{row?:Medication;onDelete?:()=>void}) {
  const [title,setTitle]=useState(row?.title??''),[dosage,setDosage]=useState(row?.dosage??'');
  const [times,setTimes]=useState(row?.times??['08:00']);
  const [days,setDays]=useState(row?.weekdays??[0,1,2,3,4,5,6]);
  const [end,setEnd]=useState(row?.course_end??''),[stock,setStock]=useState(row?.stock==null?'':String(row.stock));
  const addTime=()=>{
    const start=times.at(-1)?.split(':').map(Number)??[8,0];
    for(let step=1;step<=24;step++){
      const value=wallClock(start[0]*60+start[1]+60*step);
      if(!times.includes(value)){setTimes([...times,value]);break;}
    }
  };
  return <HealthForm title={row?t('Изменить лекарство'):t('Новое лекарство')} description={t('Укажите назначенное вам расписание')}
    action={row?t('Сохранить'):t('Добавить')} onClose={onClose} onRun={async()=>{
      if(!title.trim()||!dosage.trim()||!days.length||times.some(time=>!time)||new Set(times).size!==times.length)
        throw new Error(t('Заполните название, дозировку, уникальные часы и дни приёма.'));
      await saveHealth('/health/medications',{title:title.trim(),dosage:dosage.trim(),times,weekdays:days,course_end:end||null,
        stock:stock===''?null:Number(stock)},row);onSaved();
    }}>
    <label className="health-field">{t('Название')}<input required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="health-field">{t('Назначенная дозировка')}<input required maxLength={100} value={dosage} onChange={e=>setDosage(e.target.value)}/></label>
    <fieldset className="health-inline-field"><legend>{t('Время приёма')}</legend><div className="health-med-times">
      {times.map((time,index)=><span className="health-med-time" key={index}><HIcon name="clock" size={12}/>
        <input type="time" required aria-label={t('Время приёма {0}',index+1)} value={time}
          onChange={e=>setTimes(old=>old.map((value,i)=>i===index?e.target.value:value))}/>
        {times.length>1&&<button type="button" aria-label={t('Удалить время {0}',index+1)} onClick={()=>setTimes(old=>old.filter((_,i)=>i!==index))}><HIcon name="x" size={12}/></button>}
      </span>)}
      <button type="button" className="health-button health-dashed" disabled={times.length>=12} onClick={addTime}><HIcon name="plus" size={14}/>{t('Время')}</button>
    </div></fieldset>
    <fieldset className="health-inline-field"><legend>{t('Дни')}</legend><div className="health-weekday-fields">
      {weekdays.map((name,i)=><button type="button" key={i} aria-pressed={days.includes(i)} onClick={()=>setDays(old=>old.includes(i)?old.filter(day=>day!==i):[...old,i])}>{name}</button>)}
    </div></fieldset>
    <div className="health-course-fields">
      <label className="health-field">{t('Курс до')}<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label className="health-field">{t('Запас')}<span className="health-unit-field"><input type="number" min={0} max={100000} value={stock}
        onChange={e=>setStock(e.target.value)}/><small>{t('приёмов')}</small></span></label>
    </div>
    {row&&onDelete&&<button className="health-link health-delete-link" type="button" onClick={onDelete}><HIcon name="trash"/>{t('Удалить')}</button>}
  </HealthForm>;
}
