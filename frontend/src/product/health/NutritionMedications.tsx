import {useEffect,useState} from 'react';
import {LifeCard,LifeRings} from '../../components/LifeCard';
import {ConfirmDialog,Modal} from '../../components/ui';
import {api,errorMessage} from '../../lib/api';
import {dayLabel,parts,shiftDay,timeText,weekDays} from '../../lib/dates';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {refreshWorkspace} from '../../lib/workspace';
import {formatAmount} from '../format';
import {FoodForm,FoodGoalForm,MedicationForm,weekdays} from './Forms';
import {ProBadge,ProPreview} from './Programs';
import {deleteHealth,HealthBar,HealthButton,HealthState,HealthTile,HealthTitle,HIcon,IconAction,healthMeals,healthRoot,macroNames,shortHealthDay,totals,useHealthData} from './shared';
import type {Food,FoodGoal,HealthSummary,Meal,Medication,MedicationSlot,MedicationTracking} from './shared';

type ScreenProps={user:User;today:string;pro:boolean;id?:string;onUpgrade:()=>void;navigate:(path:string)=>void};
const n=(value:number)=>formatAmount(Math.round(value*10)/10);
const macroBarKeys=['protein','fat','carbs'] as const;

export function NutritionScreen({user,today,pro,id,onUpgrade,navigate}:ScreenProps) {
  const [day,setDay]=useState(today),[editing,setEditing]=useState<{row?:Food;meal?:Meal}>();
  const [goalsOpen,setGoalsOpen]=useState(false),[removing,setRemoving]=useState<Food>();
  const week=weekDays(day);
  const from=week[0], end=week[6]<today?week[6]:today;
  const info=useHealthData<HealthSummary>(pro?'/health/summary?'+new URLSearchParams({from,to:end}):null);
  const goals=useHealthData<{items:FoodGoal[]}>(pro?'/health/nutrition-targets':null);
  const direct=useHealthData<Food>(pro&&id?'/health/nutrition/'+id:null);
  useEffect(()=>{if(direct.data){setDay(direct.data.day);setEditing({row:direct.data});}},[direct.data]);
  const rows=info.data?.nutrition??[], meals=rows.filter(row=>row.day===day), todayTotals=totals(meals), goal=goals.data?.items[0];
  const weekly=week.map(key=>({day:key,rows:rows.filter(row=>row.day===key)})).map(entry=>({...entry,totals:totals(entry.rows)}));
  const tracked=weekly.filter(item=>item.rows.length), weeklyTotals=totals(rows);
  const maxCalories=Math.max(1,goal?.calories??0,...weekly.map(entry=>entry.totals.calories));
  const edit=()=>pro?setEditing({}):onUpgrade();
  const close=()=>{setEditing(undefined);if(id)navigate(healthRoot+'/nutrition');};
  return <>
    <HealthTitle title={t('Питание')} subtitle={dayLabel(day,{weekday:'short',day:'numeric',month:'long'})}>
      <div className="health-segments health-date-toggle" aria-label={t('День питания')}>
        <button type="button" aria-label={t('Предыдущий день')} onClick={()=>setDay(shiftDay(day,-1))}><HIcon name="cr" size={14}/></button>
        <button type="button" aria-pressed={day===today} onClick={()=>setDay(today)}>{day===today?t('Сегодня'):shortHealthDay(day)}</button>
        <button type="button" aria-label={t('Следующий день')} disabled={day>=today} onClick={()=>setDay(shiftDay(day,1))}><HIcon name="cr" size={14}/></button>
      </div><HealthButton icon="plus" primary onClick={edit}>{t('Добавить еду')}</HealthButton>
    </HealthTitle>
    {!pro?<ProPreview title={t('Дневник питания')} onUpgrade={onUpgrade}>{t('Записывайте еду по приёмам и смотрите калории и макросы за день и неделю.')}</ProPreview>:
      !info.data?<HealthState error={info.error} reload={info.reload}/>:<>
      <LifeCard className="health-nutrition-hero">
        <div className="health-nutrition-energy">
          <LifeRings values={[{value:todayTotals.calories/(goal?.calories||maxCalories),color:'#8a5b35',track:'#f0e2d3'}]} size={142}
            label={t('Калории за день: {0}',n(todayTotals.calories))}/>
          <div><div className="health-kicker">{day===today?t('Сегодня'):shortHealthDay(day)}</div>
            <div className="health-hero-number">{n(todayTotals.calories)}<small>{goal?.calories?' / '+n(goal.calories):''} {t('ккал')}</small></div>
            {goal?.calories&&<p>{todayTotals.calories<=goal.calories?t('Осталось {0} ккал',n(goal.calories-todayTotals.calories)):
              t('Сверх ориентира на {0} ккал',n(todayTotals.calories-goal.calories))}</p>}
            <button type="button" className="health-link" onClick={()=>setGoalsOpen(true)}>{t('Ориентиры питания')}<HIcon name="pencil" size={14}/></button>
          </div>
        </div>
        <div className="health-macros">{macroBarKeys.map(key=><div key={key} data-macro={key}>
          <div><span>{macroNames[key]}</span><strong>{n(todayTotals[key])}{goal?.[key]?' / '+n(goal[key]):''} {t('г')}</strong></div>
          <HealthBar label={macroNames[key]} value={goal?.[key]?todayTotals[key]/goal[key]:0}/>
        </div>)}</div>
      </LifeCard>
      {goals.error&&<HealthState error={goals.error} reload={goals.reload}/>}
      <div className="health-nutrition-grid">
        <div className="health-meals">{healthMeals.map(([key,label,icon])=>{
          const entries=meals.filter(row=>row.meal===key);
          return <LifeCard className="health-meal" key={key}>
            <header><HealthTile icon={icon}/><h2>{label}</h2><b>{entries.length?n(totals(entries).calories)+' '+t('ккал'):'—'}</b>
              <IconAction icon="plus" label={t('Добавить еду: {0}',label)} onClick={()=>setEditing({meal:key})}/></header>
            {entries.length===0?<p>{t('Записей пока нет')}</p>:entries.map(row=><div className="health-meal-entry" key={row.id}>
              <button type="button" onClick={()=>setEditing({row})} aria-label={t('Изменить приём пищи: {0}',row.title)}><span>{row.title}</span><strong>{n(Number(row.calories))}</strong></button>
              <IconAction icon="trash" label={t('Удалить приём пищи: {0}',row.title)} onClick={()=>setRemoving(row)}/>
            </div>)}
          </LifeCard>;
        })}</div>
        <LifeCard className="health-food-week"><h2>{t('Неделя')}</h2><p>{t('Ккал по дням')}</p>
          {weekly.map((entry,index)=><button type="button" className="health-food-week-day" key={entry.day}
            aria-label={dayLabel(entry.day)} aria-pressed={entry.day===day} disabled={entry.day>today} onClick={()=>setDay(entry.day)}>
            <span>{weekdays[index]}</span><HealthBar value={entry.totals.calories/maxCalories} label={dayLabel(entry.day)}/>
            <strong>{entry.rows.length?n(entry.totals.calories):'—'}</strong>
          </button>)}
          {tracked.length>0&&<p>{t('В среднем {0} ккал · белок {1} г',n(weeklyTotals.calories/tracked.length),n(weeklyTotals.protein/tracked.length))}</p>}
        </LifeCard>
      </div>
    </>}
    {direct.error&&<HealthState error={direct.error} reload={direct.reload}/>}
    {editing&&<FoodForm user={user} row={editing.row} meal={editing.meal} day={day} onClose={close} onSaved={close}/>}
    {goalsOpen&&<FoodGoalForm row={goal} onClose={()=>setGoalsOpen(false)} onSaved={()=>setGoalsOpen(false)}/>}
    {removing&&<ConfirmDialog title={t('Удалить приём пищи?')} description={t('Запись исчезнет из истории.')} onClose={()=>setRemoving(undefined)}
      onConfirm={async()=>{await deleteHealth('/health/nutrition',removing);setRemoving(undefined);}}/>}
  </>;
}

export function MedicationScreen({user,today,pro,id,onUpgrade,navigate,tracking,slots}:ScreenProps&{
  tracking:ReturnType<typeof useHealthData<MedicationTracking>>;slots:ReturnType<typeof useHealthData<{items:MedicationSlot[]}>>;
}) {
  const [editing,setEditing]=useState<Medication|null>(),[removing,setRemoving]=useState<Medication>();
  const [archive,setArchive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const direct=useHealthData<Medication>(pro&&id?'/health/medications/'+id:null);
  useEffect(()=>{if(direct.data)setEditing(direct.data);},[direct.data]);
  const close=()=>{setEditing(undefined);if(id)navigate(healthRoot+'/medications');};
  const schedule=slots.data?.items??[];
  const courses=tracking.data?.courses??[], active=courses.filter(course=>!course.course_end||course.course_end>=today);
  const expired=courses.filter(course=>!!course.course_end&&course.course_end<today);
  const count=schedule.filter(slot=>slot.taken).length;
  const now=parts(new Date(),user.timezone), stamp=now.hour+':'+now.minute;
  const next=schedule.find(slot=>!slot.taken&&!slot.skipped&&slot.time>=stamp);
  const history=tracking.data?.days??[];
  const due=history.reduce((sum,day)=>sum+day.total,0),taken=history.reduce((sum,day)=>sum+day.taken,0);
  const warning=active.find(course=>course.remaining!=null&&course.remaining<=course.times.length*3);
  const mark=async(slot:MedicationSlot,status:'taken'|'skipped'|'reset')=>{
    if(busy)return;
    setBusy(true);setError('');
    try{
      await api('/health/medications/'+slot.row.id+'/intakes',{method:'POST',
        body:{day:today,time:slot.time,version:slot.row.version,taken:status==='taken',skipped:status==='skipped'}});
      refreshWorkspace();
    }catch(cause){setError(errorMessage(cause));slots.reload();}
    finally{setBusy(false);}
  };
  const courseList=(records:Medication[])=><div className="health-course-list">{records.map(course=><article key={course.id}>
    <div><strong>{course.title}</strong><p>{course.dosage} · {course.times.join(', ')}</p>
      {course.weekdays?.length<7&&<small>{course.weekdays.map(index=>weekdays[index]).join(', ')}</small>}
      {course.course_end&&<small>{t('Курс до')} {shortHealthDay(course.course_end)}</small>}</div>
    <div className="health-course-actions"><IconAction icon="pencil" label={t('Изменить лекарство: {0}',course.title)} onClick={()=>{setArchive(false);setEditing(course);}}/>
      {archive&&<IconAction icon="trash" label={t('Удалить лекарство: {0}',course.title)} onClick={()=>{setArchive(false);setRemoving(course);}}/>}</div>
    {course.remaining!=null&&<div className="health-course-stock"><HealthBar value={course.remaining/(course.stock||1)} label={t('Запас')}/>
      <span>{t('Осталось приёмов: {0}',course.remaining)}</span></div>}
  </article>)}</div>;
  return <>
    <HealthTitle title={t('Лекарства')} subtitle={t('По назначенному расписанию · напомним вовремя')}>
      <ProBadge/><HealthButton icon="plus" primary onClick={()=>pro?setEditing(null):onUpgrade()}>{t('Добавить лекарство')}</HealthButton>
    </HealthTitle>
    {!pro?<ProPreview title={t('Расписание лекарств')} onUpgrade={onUpgrade}>{t('Добавляйте назначенные часы, отмечайте приёмы и следите за запасом.')}</ProPreview>:
      !tracking.data||!slots.data?<HealthState error={tracking.error??slots.error} reload={()=>{tracking.reload();slots.reload();}}/>:
      <div className="health-columns health-meds-grid">
        <div className="health-meds-left">
          <LifeCard className="health-today-doses"><h2>{t('Сегодня')}</h2><p>{t('{0} из {1} приёмов',count,schedule.length)}
            {next?' · '+t('следующий в {0}',next.time):''}</p>
            {error&&<p role="alert" className="health-error">{error}</p>}
            <div className="health-dose-list">{schedule.map(slot=><article key={slot.row.id+slot.time}
              data-done={slot.taken||slot.skipped||undefined} data-next={slot===next||undefined}>
              <time>{slot.time}</time><HealthTile icon="pill"/>
              <div><strong>{slot.row.title}</strong><small>{slot.row.dosage}</small></div>
              <div className="health-dose-actions">{slot.taken||slot.skipped?<button type="button" className="health-chip" disabled={busy}
                title={t('Снять отметку')} aria-label={t('Снять отметку: {0}, {1}',slot.row.title,slot.time)} onClick={()=>void mark(slot,'reset')}>
                <HIcon name={slot.taken?'check':'x'} size={12}/>{slot.taken?t('Принято {0}',slot.taken_at?timeText(slot.taken_at,user.timezone):''):t('Пропущено')}
              </button>:<>
                <button type="button" className="health-link" disabled={busy} onClick={()=>void mark(slot,'skipped')}>{t('Пропустить')}</button>
                <HealthButton icon="check" primary={slot===next} disabled={busy} onClick={()=>void mark(slot,'taken')}>{t('Принять')}</HealthButton>
              </>}</div>
            </article>)}</div>
            {schedule.length===0&&<p>{t('На сегодня нет назначенных приёмов.')}</p>}
          </LifeCard>
          <LifeCard className="health-regularity"><h2>{t('Регулярность')}</h2>
            <p>{due?t('14 дней · отмечено {0}%',Math.round(taken/due*100)):t('14 дней · пока нет приёмов')}</p>
            <div className="health-regularity-cells">{history.map(day=><span key={day.day} data-state={!day.total?'empty':day.taken===day.total?'full':day.taken?'partial':'missed'}
              title={shortHealthDay(day.day)+' · '+day.taken+'/'+day.total} aria-label={shortHealthDay(day.day)+' · '+day.taken+'/'+day.total}/>)}</div>
            <footer><span>{history.length?shortHealthDay(history[0].day):''}</span><span>{t('Сегодня')}</span></footer>
          </LifeCard>
        </div>
        <LifeCard className="health-courses"><div className="health-card-head"><h2>{t('Мои лекарства')}</h2>
          <button className="health-link" type="button" onClick={()=>setArchive(true)}>{t('Архив')}<HIcon name="arrow" size={14}/></button></div>
          {active.length?courseList(active):<p>{t('Активных курсов пока нет.')}</p>}
          {warning&&<div className="health-callout health-alert"><HIcon name="alert"/><span>{t('Заканчивается запас: {0}',warning.title)}</span></div>}
        </LifeCard>
      </div>}
    {direct.error&&<HealthState error={direct.error} reload={direct.reload}/>}
    {archive&&<Modal title={t('Архив лекарств')} className="health-modal" onClose={()=>setArchive(false)}><div className="health-archive-body">
      {expired.length?courseList(expired):<p>{t('Завершённых курсов пока нет.')}</p>}
    </div></Modal>}
    {editing!==undefined&&<MedicationForm user={user} row={editing??undefined} onClose={close} onSaved={close}
      onDelete={editing?()=>{setRemoving(editing);close();}:undefined}/>}
    {removing&&<ConfirmDialog title={t('Удалить лекарство?')} description={t('Курс и его расписание исчезнут из списка.')} onClose={()=>setRemoving(undefined)}
      onConfirm={async()=>{await deleteHealth('/health/medications',removing);setRemoving(undefined);}}/>}
  </>;
}
