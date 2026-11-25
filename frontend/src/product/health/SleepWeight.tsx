import {useEffect,useState} from 'react';
import {LifeCard} from '../../components/LifeCard';
import {ConfirmDialog,Modal} from '../../components/ui';
import {errorMessage} from '../../lib/api';
import {dateKey,dayDate,dayLabel,minutesOfDay,shiftDay,timeText} from '../../lib/dates';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {formatAmount} from '../format';
import {sleepRhythm} from '../sleepRhythm';
import {displayWeight,storeWeight,weightLabel} from '../weight';
import {HealthBar,HealthButton,HealthSegment,HealthState,HealthTile,HealthTitle,HIcon,IconAction,clock,csvWeightDownload,decimalWeight,
  deleteHealth,healthRoot,saveHealth,shortHealthDay,signed,summaryPath,useHealthData,wallClock} from './shared';
import type {HealthSummary,Sleep,Weight,WeightGoal} from './shared';
import {SleepForm,WeightForm,WeightStepper,sleepQuality} from './Forms';

type DetailProps={user:User;today:string;pro:boolean;id?:string;onUpgrade:()=>void;navigate:(path:string)=>void};
const sleepChoices=[[7,t('7 ночей')],[30,'30'],[90,'90']] as const;
const weightChoices=[[30,t('30Д')],[90,t('90Д')],[182,t('6М')],[365,t('Год')]] as const;
const sleepGoal=480;
const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const sleepMinutes=(row:Sleep)=>Math.round((Date.parse(row.end_at)-Date.parse(row.start_at))/60000);

function nightlyMinutes(rows:Sleep[],zone:string) {
  const byDay=new Map<string,{start:number;end:number}[]>();
  for(const row of rows){
    const day=dateKey(row.end_at,zone);
    const intervals=byDay.get(day)??[];
    intervals.push({start:Date.parse(row.start_at),end:Date.parse(row.end_at)});
    byDay.set(day,intervals);
  }
  return new Map([...byDay].map(([day,intervals])=>{
    let latest=0,total=0;
    for(const {start,end} of intervals.sort((a,b)=>a.start-b.start)){
      total+=Math.max(0,end-Math.max(start,latest));
      latest=Math.max(latest,end);
    }
    return [day,Math.round(total/60000)];
  }));
}

function QualityMarks({value}:{value?:number}) {
  return <span className="health-quality-marks" aria-label={value?t('Качество {0} из 5',value):t('Качество не отмечено')}>
    {Array.from({length:5},(_,index)=><i data-filled={index<(value??0)||undefined} key={index}/>)}</span>;
}

export function SleepScreen({user,today,pro,id,onUpgrade,navigate}:DetailProps) {
  const [days,setDays]=useState<7|30|90>(7);
  const [editing,setEditing]=useState<Sleep|null>(),[all,setAll]=useState(false),[removing,setRemoving]=useState<Sleep>();
  const data=useHealthData<HealthSummary>(summaryPath(today,days));
  const direct=useHealthData<Sleep>(id?'/health/sleep/'+id:null);
  useEffect(()=>{if(direct.data)setEditing(direct.data);},[direct.data]);
  const zone=user.timezone, last=data.data?.sleep.slice().reverse()??[];
  const manual=last.map(row=>({...row,hours:sleepMinutes(row)/60}));
  const rhythm=sleepRhythm(manual,zone);
  const device=new Map((data.data?.device_days??[]).filter(day=>day.sleep_seconds!==null&&!rhythm.byDay.has(day.day))
    .map(day=>[day.day,Math.round(day.sleep_seconds!/60)]));
  const totalByDay=nightlyMinutes(last,zone);
  device.forEach((minutes,day)=>totalByDay.set(day,minutes));
  const average=mean([...totalByDay.values()]);
  const bed=mean(last.map(row=>{const minute=minutesOfDay(row.start_at,zone);return minute>=720?minute-1440:minute;}));
  const wake=mean(last.map(row=>minutesOfDay(row.end_at,zone)));
  const score=mean(last.map(row=>row.quality));
  const value=(minutes:number|null)=>minutes===null?'—':clock(minutes);
  const intervals=[...rhythm.byDay.values()].flatMap(day=>day.slots);
  const axisStart=Math.min(-240,...intervals.map(slot=>slot.start));
  const axisEnd=Math.max(480,...intervals.map(slot=>slot.end));
  const left=(minute:number)=>100*(minute-axisStart)/(axisEnd-axisStart);
  const ticks=Array.from({length:5},(_,index)=>wallClock(axisStart+(axisEnd-axisStart)*index/4));
  const selectedDays=Array.from({length:days},(_,index)=>shiftDay(today,-index));
  const qualityByDay=new Map(last.slice().reverse().map(row=>[dateKey(row.end_at,zone),row.quality]));
  const closeEdit=()=>{setEditing(undefined);if(id)navigate(healthRoot+'/sleep');};
  const rows=(values:Sleep[])=><div className="health-night-list">{values.map(row=><div key={row.id}>
    <span><strong>{dayLabel(dateKey(row.end_at,zone),{weekday:'short',day:'numeric'})}</strong> · {value(sleepMinutes(row))}<small>{timeText(row.start_at,zone)} → {timeText(row.end_at,zone)}</small></span>
    <span className="health-chip">{sleepQuality[row.quality-1]}</span>
    <IconAction icon="pencil" label={t('Изменить запись сна')} onClick={()=>{setAll(false);setEditing(row);}}/>
    {all&&<IconAction icon="trash" label={t('Удалить запись сна')} onClick={()=>{setAll(false);setRemoving(row);}}/>}
  </div>)}</div>;
  return <>
    <HealthTitle title={t('Сон')} subtitle={average===null?t('Записи о сне и режим'):t('В среднем за период {0} · ориентир 8 ч',value(average))}>
      <HealthSegment choices={sleepChoices} value={days} onSelect={choice=>choice===90&&!pro?onUpgrade():setDays(choice)} label={t('Период сна')}/>
      <HealthButton icon="moon" primary onClick={()=>setEditing(null)}>{t('Записать сон')}</HealthButton>
    </HealthTitle>
    {!data.data?<HealthState error={data.error} reload={data.reload}/>:<>
      <div className="health-stat-grid">
        {([
          ['moon',t('В среднем'),value(average),t('ч'),average===null?'—':average>=sleepGoal?t('Ориентир достигнут'):t('До ориентира {0} мин',Math.round(sleepGoal-average))],
          ['sun',t('Отбой'),bed===null?'—':wallClock(bed),'',t('Среднее местное время')],
          ['sun',t('Подъём'),wake===null?'—':wallClock(wake),'',t('Среднее местное время')],
          ['smile',t('Качество'),score===null?'—':formatAmount(Math.round(score*10)/10),'/ 5',t('По вашим оценкам')],
        ] as const).map(([icon,label,number,unit,caption],index)=><LifeCard className="health-stat" key={label}>
          <div><HealthTile icon={icon}/>{label}</div><strong>{number}<small>{unit}</small></strong><p>{caption}</p>
          {index===0&&average!==null&&<HealthBar value={average/sleepGoal} label={t('Ориентир по длительности сна')}/>}
        </LifeCard>)}
      </div>
      <div className="health-columns">
        <LifeCard className="health-sleep-rhythm">
          <h2>{t('Ритм сна')}</h2><p>{t('Полоса от отбоя до подъёма. Светлая зона — 23:00–07:00.')}</p>
          <div className="health-rhythm-head"><span/><div>{ticks.map((label,i)=><span key={i}>{label}</span>)}</div></div>
          <div className="health-rhythm-scroller">
            {selectedDays.map(day=>{
              const record=rhythm.byDay.get(day), quality=qualityByDay.get(day);
              return <div className="health-rhythm-row" key={day}><strong>{dayLabel(day,{weekday:'short',day:'numeric'})}</strong>
                <div className="health-rhythm-track">
                  <span className="health-rhythm-goal" style={{left:left(-60)+'%',width:(left(420)-left(-60))+'%'}}/>
                  {record?.slots.map((slot,key)=><span key={key} className="health-rhythm-interval" data-quality={quality}
                    style={{left:left(slot.start)+'%',width:(left(slot.end)-left(slot.start))+'%'}} title={slot.label}/>)}
                  {device.has(day)&&<span className="health-rhythm-device">{t('С устройства')}</span>}
                </div><strong>{value(totalByDay.get(day)??null)}</strong><QualityMarks value={quality}/>
              </div>;
            })}
          </div>
          <div className="health-rhythm-legend"><QualityMarks value={4}/>{t('Качество сна отмечаете вы')}</div>
        </LifeCard>
        <LifeCard className="health-last-nights">
          <div className="health-card-head"><h2>{t('Последние ночи')}</h2>
            {last.length>0&&<button className="health-link" type="button" onClick={()=>setAll(true)}>{t('Все')}<HIcon name="arrow" size={14}/></button>}</div>
          {last.length?rows(last.slice(0,4)):<p>{t('Пока нет ручных записей о сне.')}</p>}
          <button className="health-callout health-sleep-link" type="button" onClick={()=>navigate('/modules/insights/links?pair=sleep%3Ahabits')}>
            <HIcon name="sparkles"/><span>{t('Связь сна и привычек')}</span><HIcon name="cr" size={14}/>
          </button>
        </LifeCard>
      </div>
    </>}
    {id&&direct.error&&<HealthState error={direct.error} reload={direct.reload}/>}
    {all&&<Modal title={t('Записи сна')} className="health-modal health-night" onClose={()=>setAll(false)}><div className="health-archive-body">{rows(last)}</div></Modal>}
    {editing!==undefined&&<SleepForm row={editing??undefined} user={user} onSaved={closeEdit} onClose={closeEdit}/>}
    {removing&&<ConfirmDialog title={t('Удалить запись сна?')} description={t('Запись исчезнет из истории.')} onClose={()=>setRemoving(undefined)} onConfirm={async()=>{await deleteHealth('/health/sleep',removing);setRemoving(undefined);}}/>}
  </>;
}

const modes=[['gain',t('Набор')],['maintain',t('Удержание')],['lose',t('Снижение')]] as const;
const modeText={gain:t('набор массы'),maintain:t('удержание веса'),lose:t('снижение веса')};
function weightText(row:Weight|null|undefined,unit:string) {
  return row?decimalWeight(displayWeight(row.kg,unit)):'—';
}
function WeightTargetCard({goal,current,user,pro,onUpgrade}:{goal?:WeightGoal;current?:Weight;user:User;pro:boolean;onUpgrade:()=>void}) {
  const [value,setValue]=useState(goal?decimalWeight(displayWeight(goal.kg,user.weight_unit)):current?decimalWeight(displayWeight(current.kg,user.weight_unit)):'');
  const [mode,setMode]=useState<WeightGoal['mode']>(goal?.mode??'maintain');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <LifeCard className="health-weight-goal"><h2>{t('Цель')}</h2>
    <form onSubmit={async e=>{
      e.preventDefault();if(!pro){onUpgrade();return;}if(busy)return;
      const amount=Number(value.replace(',','.'));
      if(!Number.isFinite(amount)||amount<=0||amount>displayWeight(1000,user.weight_unit)){setError(t('Введите допустимый вес.'));return;}
      setBusy(true);setError('');try{await saveHealth('/health/weight-targets',{kg:storeWeight(amount,user.weight_unit),mode},goal);}
      catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
    }}>
      <WeightStepper label={t('Целевой вес')} value={value} onChange={setValue} unit={weightLabel(user.weight_unit)}/>
      <p>{pro?t('Ваш ориентир веса'):t('Цель веса доступна с Pro')}</p>
      <HealthSegment choices={modes} value={mode} onSelect={setMode} label={t('Режим цели')}/>
      {error&&<p className="health-error" role="alert">{error}</p>}
      <button className="health-button health-soft" disabled={busy}>{pro?t('Сохранить цель'):t('Посмотреть Pro')}</button>
    </form>
  </LifeCard>;
}

function WeightChart({rows,goal,unit,onSelect}:{rows:Weight[];goal?:WeightGoal;unit:string;onSelect:(row:Weight)=>void}) {
  if(!rows.length)return <p className="health-empty">{t('Добавьте измерение, чтобы увидеть график.')}</p>;
  const values=rows.map(row=>displayWeight(row.kg,unit));
  const target=goal?displayWeight(goal.kg,unit):null;
  const low=Math.min(...values,target??Infinity), high=Math.max(...values,target??-Infinity);
  const padding=Math.max(0.7,(high-low)*0.18);
  const y=(kg:number)=>210-(kg-low+padding)/(high-low+padding*2)*184;
  const start=+dayDate(rows[0].day),end=+dayDate(rows.at(-1)!.day);
  const x=(day:string)=>end===start?65:48+(+dayDate(day)-start)/(end-start)*554;
  const points=rows.map((row,index)=>({row,x:x(row.day),y:y(values[index])}));
  const path=points.map((point,index)=>(index?'L':'M')+point.x+','+point.y).join(' ');
  const grid=Array.from({length:5},(_,i)=>low-padding+(high-low+padding*2)*i/4);
  const ticks=rows.filter((row,i)=>i===0||row.day.slice(0,7)!==rows[i-1].day.slice(0,7));
  const dates=ticks.length<=7?ticks:ticks.filter((_,i)=>i%Math.ceil(ticks.length/6)===0);
  return <svg className="health-weight-chart" viewBox="0 0 626 245" role="group" aria-label={t('Динамика веса')}>
    {grid.map(value=><g key={value}><line x1="48" x2="602" y1={y(value)} y2={y(value)}/><text x="2" y={y(value)+4}>{formatAmount(Math.round(value*10)/10)}</text></g>)}
    {target!==null&&<g className="health-chart-target"><line x1="48" x2="602" y1={y(target)} y2={y(target)}/><text x="602" y={y(target)-7} textAnchor="end">{t('цель {0} {1}',formatAmount(target),weightLabel(unit))}</text></g>}
    {points.length>1&&<path className="health-chart-area" d={path+' L'+points.at(-1)!.x+',211 L'+points[0].x+',211 Z'}/>}
    <path className="health-chart-line" d={path}/>
    {points.map(({x,y,row},i)=><g tabIndex={0} role="button" key={row.id} className="health-chart-point"
      aria-label={shortHealthDay(row.day)+' · '+weightText(row,unit)+' '+weightLabel(unit)}
      onClick={()=>onSelect(row)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(row);}}}>
      <circle className="health-chart-hit" cx={x} cy={y} r="11"/><circle cx={x} cy={y} r={i===points.length-1?5:3} data-last={i===points.length-1||undefined}/>
    </g>)}
    {dates.map((row,index)=><text x={x(row.day)} key={row.id} y="235" textAnchor={index===0?'start':x(row.day)>560?'end':'middle'}>{dayLabel(row.day,{month:'short'})}</text>)}
  </svg>;
}

export function WeightScreen({user,today,pro,id,onUpgrade,navigate}:DetailProps) {
  const [days,setDays]=useState<30|90|182|365>(pro?182:30),[selected,setSelected]=useState<Weight>(),[editing,setEditing]=useState<Weight|null>();
  const [removing,setRemoving]=useState<Weight>(),[all,setAll]=useState(false);
  const history=useHealthData<HealthSummary>(summaryPath(today,pro?365:30));
  const goals=useHealthData<{items:WeightGoal[]}>(pro?'/health/weight-targets':null);
  const direct=useHealthData<Weight>(id?'/health/weight/'+id:null);
  useEffect(()=>{if(direct.data)setSelected(direct.data);},[direct.data]);
  const rows=(history.data?.weight??[]).slice().sort((a,b)=>a.day.localeCompare(b.day)||(a.created_at??'').localeCompare(b.created_at??''));
  const unit=user.weight_unit??'kg',label=weightLabel(unit),kg=(row:Weight)=>displayWeight(row.kg,unit);
  const current=rows.at(-1),goal=goals.data?.items[0],filtered=rows.filter(row=>row.day>=shiftDay(today,1-days));
  const baseline=filtered[0]??rows[0],target=goal?displayWeight(goal.kg,unit):null;
  const delta=(row:Weight,prior?:Weight)=>prior?signed(kg(row)-kg(prior))+' '+label:'—';
  const before=(row:Weight)=>rows[rows.findIndex(value=>value.id===row.id)-1];
  const beforeMonth=(row:Weight)=>{const cutoff=shiftDay(row.day,-30);return rows.filter(item=>item.day<=cutoff).at(-1);};
  const baselineDistance=baseline&&target!==null?Math.abs(target-kg(baseline)):0;
  const currentDistance=current&&target!==null?Math.abs(target-kg(current)):0;
  const progress=current&&target!==null?1-currentDistance/(Math.max(currentDistance,baselineDistance)||1):0;
  const closeSelection=()=>{setSelected(undefined);if(id)navigate(healthRoot+'/weight');};
  return <>
    <HealthTitle title={t('Вес')} subtitle={goal?t('Цель {0} {1} · {2}',formatAmount(target),label,modeText[goal.mode]):t('Измерения и личный ориентир')}/>
    <LifeCard className="health-weight-hero">
      <div><p className="health-kicker">{t('Сейчас')}</p><div className="health-hero-number">{weightText(current,unit)}<small>{label}</small></div>
        <div className="health-chip-row">{current&&beforeMonth(current)&&<span className="health-chip health-warm"><HIcon name="trend" size={12}/>{delta(current,beforeMonth(current))} {t('за 30 дней')}</span>}
          {current&&<span className="health-chip">{shortHealthDay(current.day)}</span>}</div></div>
      <div className="health-weight-path">
        <div><strong>{t('Путь к цели')}</strong>{target!==null&&current&&<b>{t('До цели {0} {1}',formatAmount(Math.abs(target-kg(current))),label)}</b>}</div>
        {target!==null&&current&&baseline?<><HealthBar value={progress} label={t('Путь к цели')}/><div className="health-weight-track-label">
          <span>{weightText(baseline,unit)} · {t('старт')}</span><span>{weightText(current,unit)} · {t('сейчас')}</span><span>{formatAmount(target)} · {t('цель')}</span></div></>:
          <p>{t('Добавьте измерение и цель, чтобы видеть прогресс.')}</p>}
      </div>
      <HealthButton icon="plus" primary onClick={()=>setEditing(null)}>{t('Записать вес')}</HealthButton>
    </LifeCard>
    {!history.data?<HealthState error={history.error} reload={history.reload}/>:<>
      <div className="health-columns">
        <LifeCard className="health-weight-trend"><div className="health-card-head">
          <div><h2>{t('Динамика')}</h2><p>{t('Измерений за период: {0}',filtered.length)}</p></div>
          <HealthSegment choices={weightChoices} value={days} onSelect={choice=>choice>30&&!pro?onUpgrade():setDays(choice)} label={t('Период веса')}/>
        </div><WeightChart rows={filtered} goal={goal} unit={unit} onSelect={setSelected}/></LifeCard>
        <WeightTargetCard key={goal?.version??current?.id??'empty'} goal={goal} current={current} user={user} pro={pro} onUpgrade={onUpgrade}/>
      </div>
      <LifeCard className="health-measurements"><div className="health-card-head"><h2>{t('Измерения')}</h2>
        {rows.length>0&&<button type="button" className="health-link" onClick={()=>csvWeightDownload(rows,label,row=>Math.round(kg(row)*1000)/1000)}>{t('Экспорт CSV')}<HIcon name="arrow" size={14}/></button>}
      </div>
      {rows.length===0&&<p>{t('Измерений пока нет.')}</p>}
      {rows.slice().reverse().slice(0,all?rows.length:4).map(row=><div className="health-measure-row" key={row.id}>
        <button onClick={()=>setSelected(row)} type="button"><span>{shortHealthDay(row.day)}</span><strong>{weightText(row,unit)} {label}</strong>
          <span className="health-chip health-warm">{delta(row,before(row))}</span><span className="health-measure-note">{row.notes}</span></button>
        <IconAction icon="pencil" label={t('Изменить измерение')} onClick={()=>setEditing(row)}/>
        <IconAction icon="trash" label={t('Удалить измерение')} onClick={()=>setRemoving(row)}/>
      </div>)}
      {rows.length>4&&<HealthButton onClick={()=>setAll(!all)}>{all?t('Свернуть'):t('Показать все')}</HealthButton>}
      </LifeCard>
    </>}
    {id&&direct.error&&<HealthState error={direct.error} reload={direct.reload}/>}
    {selected&&<Modal title={dayLabel(selected.day,{day:'numeric',month:'long',year:'numeric'})} className="health-modal health-drawer" onClose={closeSelection}>
      <div className="health-drawer-body">
        <div className="health-hero-number">{weightText(selected,unit)}<small>{label}</small></div>
        <dl>{[[t('К прошлому'),delta(selected,before(selected))],[t('За 30 дней'),delta(selected,beforeMonth(selected))],
          [t('До цели'),target===null?'—':formatAmount(Math.abs(target-kg(selected)))+' '+label],[t('Заметка'),selected.notes||'—']]
          .map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        <div className="health-form-footer"><HealthButton icon="pencil" onClick={()=>{setEditing(selected);closeSelection();}}>{t('Изменить')}</HealthButton>
          <HealthButton icon="trash" onClick={()=>{setRemoving(selected);closeSelection();}}>{t('Удалить')}</HealthButton></div>
      </div>
    </Modal>}
    {editing!==undefined&&<WeightForm row={editing??undefined} prior={editing?before(editing):current} goal={goal} user={user}
      onClose={()=>setEditing(undefined)} onSaved={()=>setEditing(undefined)}/>}
    {removing&&<ConfirmDialog title={t('Удалить измерение?')} description={t('Запись исчезнет из истории.')} onClose={()=>setRemoving(undefined)}
      onConfirm={async()=>{await deleteHealth('/health/weight',removing);setRemoving(undefined);}}/>}
  </>;
}
