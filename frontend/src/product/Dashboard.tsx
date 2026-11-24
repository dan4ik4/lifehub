import { t, locale } from '../lib/language';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Check,ChevronDown,Clock3,Layers,Moon,Plus,Scale,Target,Wallet} from 'lucide-react';
import type {CalendarEvent,Notify,Task,TaskOccurrence,User} from '../lib/types';
import {api,errorMessage} from '../lib/api';
import {dayLabel,todayKey} from '../lib/dates';
import {openQuickAdd} from '../lib/workspace';
import {LifeBars,LifeCard,LifeLink,LifeRings} from '../components/LifeCard';
import {Modal,ConfirmDialog} from '../components/ui';
import {Avatar} from '../components/Avatar';
import {formatAmount} from './format';
import {displayWeight,weightLabel} from './weight';
import {openWorkout,useActiveWorkout} from './WorkoutSession';

const widgetTitles = {sleep:t("Сон"),weight:t("Вес"),finance:t("Расходы"),books:t("Читаю"),free:t("Свободное время"),insights:t("Что видно вместе")} as const;
type HomeWidget = keyof typeof widgetTitles;
const defaults:HomeWidget[]=['sleep','weight','finance','books'];
const duration=(minutes:number)=>[Math.floor(minutes/60)?Math.floor(minutes/60)+t(" ч"):'',minutes%60?minutes%60+t(" мин"):''].filter(Boolean).join(' ')||t("0 мин");
const sleepTime=(hours:number)=>Math.floor(Math.round(hours*60)/60)+':'+String(Math.round(hours*60)%60).padStart(2,'0');
function widgetSelection(id:string):HomeWidget[] {
  try {
    const value:unknown=JSON.parse(localStorage.getItem('lifehub.home.widgets.'+id)??'null');
    if(Array.isArray(value)) return [...new Set(value.filter((key):key is HomeWidget=>typeof key==='string'&&Object.hasOwn(widgetTitles,key)))];
  } catch {}
  return defaults;
}

type DashboardData = {
  day:string;
  widgets:{
    planning?:{tasks:{task:Task;occurrence:TaskOccurrence}[];events:CalendarEvent[]};
    habits?:{id:string;title:string;version:number;today_complete:boolean;target:string;kind:string}[];
    sleep_week?:{day:string;hours:number|null}[];
    budgets?:{currency:string;amount:string;percent:number}[];
    sleep?:{hours:number;end_at?:string;day?:string}|null;
    weight?:{day:string;kg:string}[];
    workouts?:{count:number;minutes:number};
    books?:{id:string;title:string;author:string;cover_id:number|null;current_page:number;total_pages:number|null}[];
    finance?:{currency:string;kind:string;amount:string}[];
  };
};

export function Dashboard({user,navigate,notify,onProfile}: {user:User;navigate:(path:string)=>void;notify:Notify;onProfile:()=>void}) {
  const workout=useActiveWorkout(user.id);
  const [data,setData] = useState<DashboardData|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [acting,setActing] = useState('');
  const [customize,setCustomize]=useState(false);
  const [selectedWidgets,setSelectedWidgets]=useState(()=>widgetSelection(user.id));
  const [liveDetails,setLiveDetails]=useState(false);
  const [finishEvent,setFinishEvent]=useState<CalendarEvent|null>(null);
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),30_000);
    const configure=()=>setCustomize(true);
    window.addEventListener('lifehub:customize-home',configure);
    return ()=>{window.clearInterval(timer);window.removeEventListener('lifehub:customize-home',configure);};
  },[]);
  function toggleWidget(key:HomeWidget){
    const next=selectedWidgets.includes(key)?selectedWidgets.filter(w=>w!==key):[...selectedWidgets,key];
    setSelectedWidgets(next);
    try {localStorage.setItem('lifehub.home.widgets.'+user.id,JSON.stringify(next));} catch {}
  }
  const controller = useRef<AbortController|null>(null);
  const mutation = useRef(false);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request=new AbortController();
    controller.current=request;
    setLoading(true);
    setError('');
    try {
      const result=await api<DashboardData>('/dashboard',{signal:request.signal});
      if (!request.signal.aborted) setData(result);
    } catch (cause) {
      if (!request.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [user.id]);
  useEffect(() => {
    void refresh();
    const update=() => void refresh();
    window.addEventListener('focus',update);
    window.addEventListener('lifehub:data-changed',update);
    return () => {
      controller.current?.abort();
      window.removeEventListener('focus',update);
      window.removeEventListener('lifehub:data-changed',update);
    };
  }, [refresh]);

  async function mark(path:string, body:unknown, id:string) {
    if (mutation.current) return;
    mutation.current=true;
    setActing(id);
    try {
      await api(path,{method:'POST',body});
      await refresh();
    } catch (cause) {
      notify(errorMessage(cause),'error');
      await refresh();
    } finally {
      mutation.current=false;
      setActing('');
    }
  }

  const widgets=data?.widgets;
  const plans=widgets?.planning;
  const day=data?.day??todayKey(user.timezone);
  const time=(stamp:string) => new Date(stamp).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:user.timezone});
  const events=[...new Map((plans?.events??[]).map(event => [event.id+':'+event.occurrence_at,event])).values()]
    .sort((a,b) => Date.parse(a.start_at)-Date.parse(b.start_at));
  const tasks=[...new Map((plans?.tasks??[]).map(record => [record.task.id+':'+record.occurrence.occurrence_at,record])).values()];
  const current=events.find(event=>!event.all_day&&Date.parse(event.start_at)<=now&&Date.parse(event.end_at)>now);
  const completed=tasks.filter(({occurrence})=>occurrence.status==='completed').length;
  const habits=widgets?.habits??[];
  const habitsDone=habits.filter(h=>h.today_complete).length;
  const currencies=[...new Set(widgets?.finance?.map(row=>row.currency)??[])];
  const activeCurrency=currencies.includes('PLN')?'PLN':currencies[0];
  const expense=widgets?.finance?.find(row=>row.currency===activeCurrency&&row.kind==='expense')?.amount;
  const budgets=widgets?.budgets?.filter(row=>row.currency===activeCurrency)??[];
  const budgetSum=budgets.reduce((sum,row)=>sum+Number(row.amount),0);
  const book=widgets?.books?.[0], weight=widgets?.weight?.at(-1), workoutMinutes=widgets?.workouts?.minutes??0;
  const reading=book?.total_pages?Math.min(100,Math.round(100*book.current_page/book.total_pages)):null;
  const doneRatio=tasks.length?completed/tasks.length:0, habitRatio=habits.length?habitsDone/habits.length:0;
  const progressRatios=[...(plans?[doneRatio]:[]),...(widgets?.habits?[habitRatio]:[])];
  const progress=progressRatios.length?Math.round(100*progressRatios.reduce((sum,ratio)=>sum+ratio,0)/progressRatios.length):0;
  const eventLink=(event:CalendarEvent)=>'/planning/calendar?'+new URLSearchParams({day,event:event.id,...(event.occurrence_at?{occurrence:event.occurrence_at}:{})});
  const taskLink=(task:Task,occurrence:TaskOccurrence)=>'/planning?'+new URLSearchParams({day,task:task.id,...(occurrence.occurrence_at?{occurrence:occurrence.occurrence_at}:{})});
  const movement=widgets?.workouts;
  const timeline=[
    ...events.map(event=>({type:'event' as const,event,order:event.all_day?-1:Date.parse(event.start_at)})),
    ...tasks.filter(row=>row.occurrence.status!=='skipped').map(({task,occurrence})=>{
      const stamp=occurrence.effective_start_at??occurrence.effective_due_at;
      return {type:'task' as const,task,occurrence,stamp,order:task.all_day||!stamp?Infinity:Date.parse(stamp)};
    }),
  ].sort((a,b)=>a.order-b.order);
  const metric=(key:HomeWidget)=>{
    if(key==='sleep'&&widgets?.workouts) return {icon:Moon,theme:'plans',value:widgets.sleep?sleepTime(widgets.sleep.hours):'—',unit:widgets.sleep?t("ч"):'',path:'/modules/health/sleep',hint:widgets.sleep?t("Сон за последнюю ночь"):t("Нет записи о сне"),bars:widgets.sleep_week?.map(x=>x.hours)};
    if(key==='weight'&&widgets?.weight) return {icon:Scale,theme:'health',value:weight?formatAmount(displayWeight(weight.kg,user.weight_unit)):'—',unit:weight?weightLabel(user.weight_unit):'',path:'/modules/health/weight',hint:weight?t("Последнее измерение · ")+dayLabel(weight.day):t("Нет измерений"),bars:widgets.weight.map(x=>displayWeight(x.kg,user.weight_unit))};
    if(key==='finance'&&widgets?.finance) return {icon:Wallet,theme:'finance',value:expense?formatAmount(expense):'—',unit:expense?(activeCurrency==='PLN'?'zł':activeCurrency):'',path:'/modules/finance'+(activeCurrency?'?currency='+activeCurrency:''),hint:expense?t("Расходы с начала месяца"):t("Нет операций в этом месяце"),progress:budgetSum?100*Number(expense??0)/budgetSum:0};
    if(key==='books'&&widgets?.books) return {icon:BookOpen,theme:'books',value:reading??(book?book.current_page:'—'),unit:reading!==null?'%':book?t("стр."):'',path:'/modules/books/books'+(book?'/'+book.id:''),hint:book?book.title+' · '+book.current_page+(book.total_pages?t(" из ")+book.total_pages:''):t("Нет книг в чтении"),progress:reading??0};
    if(key==='free'&&plans) return {icon:Clock3,theme:'habits',value:t("Окна"),unit:'',path:'/planning/free-time',hint:t("Найдите свободное время в календаре")};
    if(key==='insights'&&(user.plan==='pro'||(user.plan==='trial'&&Date.parse(user.trial_ends??'')>now))) return {icon:Target,theme:'insights',value:t("Связи"),unit:'',path:'/modules/insights',hint:t("Сравните свои записи")};
    return null;
  };
  const liveProgress=current?Math.max(0,Math.min(100,(now-Date.parse(current.start_at))*100/(Date.parse(current.end_at)-Date.parse(current.start_at)))):0;
  return <div className="life-home">
    {workout&&widgets?.workouts&&<div className="life-live-wrapper"><button className="life-live" onClick={()=>openWorkout()}>
      <span className="life-live-icon"><Clock3 size={17}/></span><strong>{t("Идёт тренировка ·")} {workout.title}</strong><small>{duration(Math.floor((now-workout.started)/60000))}</small><ArrowRight size={16}/>
    </button></div>}
    {current && !workout && <div className="life-live-wrapper"><button className="life-live" aria-expanded={liveDetails} onClick={()=>setLiveDetails(open=>!open)}>
      <span className="life-live-icon"><CalendarDays size={17}/></span>
      <span><strong>{t("Сейчас ·")} {current.title}</strong><progress value={liveProgress} max={100} aria-label={t("Прогресс события")}/></span>
      <small>{t("ещё")} {duration(Math.ceil((Date.parse(current.end_at)-now)/60000))}</small><ChevronDown size={16}/>
    </button>{liveDetails&&<LifeCard className="life-live-details"><h3>{current.title}</h3><p>{time(current.start_at)}–{time(current.end_at)}</p><LifeLink action={()=>navigate(eventLink(current))}>{t("Открыть событие")}</LifeLink>
      {!current.recurrence&&!current.external_read_only&&<button className="button secondary" onClick={()=>setFinishEvent(current)}>{t("Завершить раньше")}</button>}</LifeCard>}</div>}
    <header className="life-home-title">
      <div><span className="life-page-eyebrow">{dayLabel(day,{weekday:'long',day:'numeric',month:'long'})}</span>
      <h1>{t("Добрый день,")} {user.name?.trim().split(/\s+/)[0]||t("друг")}</h1></div>
      <div className="life-home-actions"><button className="button secondary" onClick={()=>setCustomize(true)}><Layers size={17}/>{t("Настроить")}</button>
        <button className="button primary" onClick={()=>openQuickAdd()}><Plus size={17}/>{t("Добавить")}<kbd>N</kbd></button></div>
      <button className="life-home-avatar life-rail-avatar" onClick={onProfile} aria-label={t("Настройки профиля")}><Avatar user={user}/></button>
    </header>
    {error&&<div className="product-error" role="alert">{error}<button className="button secondary" onClick={()=>void refresh()}>{t("Повторить")}</button></div>}
    {!data&&loading&&<div className="life-home-primary" role="status" aria-label={t("Загружаем сводку")}><div className="life-card hub-placeholder"/><div className="life-card hub-placeholder"/></div>}
    {widgets&&<>
      {(plans||widgets.habits)&&<div className={'life-home-primary'+(!plans?' no-plans':'')}>
        {plans&&<LifeCard className="life-agenda">
          <header className="life-card-head"><div><h2>{t("Сегодня")}</h2><p>{events.length} {t("событий ·")} {tasks.length} {t("задач")}</p></div><LifeLink action={()=>navigate('/planning')}>{t("Мой день")}</LifeLink></header>
          <div className="life-home-timeline">{timeline.length?timeline.slice(0,8).map(row=>{
            if(row.type==='event'){
              const {event}=row, passed=Date.parse(event.end_at)<=now, active=event===current;
              return <button key={event.id+':'+event.occurrence_at} className={'life-home-event'+(active?' current':'')+(passed?' passed':'')} onClick={()=>navigate(eventLink(event))}>
                <time>{event.all_day?t("Весь день"):time(event.start_at)}</time><i/><span><strong>{event.title}</strong><small>{active?t("Идёт · до ")+time(event.end_at):time(event.start_at)+'–'+time(event.end_at)+(passed?t(" · прошло"):'')}</small>
                {active&&<progress value={liveProgress} max={100} aria-label={t("Прогресс события")}/>}</span>{active&&<em>{t("Сейчас")}</em>}
              </button>;
            }
            const {task,occurrence,stamp}=row,done=occurrence.status==='completed';
            return <div className={'life-home-task'+(done?' done':'')} key={task.id+':'+occurrence.occurrence_at}>
              <time>{stamp&&!task.all_day?time(stamp):''}</time><i/>
              <button className="life-task-check" role="checkbox" aria-label={task.title} aria-checked={done} disabled={!!acting}
                onClick={()=>void mark('/planning/tasks/'+task.id+'/'+(done?'reopen':'complete'),{version:task.version,occurrence_at:occurrence.occurrence_at},task.id)}>{done&&<Check size={13}/>}</button>
              <button className="life-task-name" onClick={()=>navigate(taskLink(task,occurrence))}>{task.title}<small>{done?t("Готово"):t("Задача")}</small></button>
            </div>;
          }):<p>{t("На сегодня пока нет планов.")}</p>}</div>
          <button className="life-agenda-add" onClick={()=>openQuickAdd('task')}><Plus size={17}/>{t("Добавить на сегодня")}<kbd>N</kbd></button>
        </LifeCard>}
        <div className="life-home-side">
          <LifeCard className="life-day-progress"><header className="life-card-head"><h3>{t("Прогресс дня")}</h3><strong>{progress}%</strong></header>
            <div className="life-progress-body"><LifeRings label={t("Прогресс дня: ")+progress+'%'} size={138} values={[
              ...(widgets.habits?[{value:habitRatio,color:'#245447'}]:[]),
              ...(plans?[{value:doneRatio,color:'#484f94',track:'#e6e7f5'}]:[]),
              ...(movement?[{value:0,color:'#895934',track:'#f3e4d6'}]:[]),
            ]}/><dl>
              {widgets.habits&&<div><dt><i/>{t("Привычки")}</dt><dd>{habitsDone} <small>/ {habits.length}</small></dd></div>}
              {plans&&<div><dt><i className="indigo"/>{t("Задачи")}</dt><dd>{completed} <small>/ {tasks.length}</small></dd></div>}
              {movement&&<div><dt><i className="brown"/>{t("Тренировки")}</dt><dd>{workoutMinutes} <small>{t("мин за неделю")}</small></dd></div>}
            </dl></div>
          </LifeCard>
          {widgets.habits&&<LifeCard className="life-home-habits"><header className="life-card-head"><h3>{t("Привычки")}</h3><span>{habitsDone} {t("из")} {habits.length}</span></header>
            <div className="life-habit-icons">
              {habits.slice(0,2).map(habit=><button key={habit.id} disabled={!!acting} aria-pressed={habit.today_complete} onClick={()=>habit.kind==='boolean'?void mark('/habits/'+habit.id+'/checkins',{version:habit.version,day,value:habit.today_complete?0:habit.target},habit.id):navigate('/modules/goals_habits')}>
                <span>{habit.today_complete?<Check size={25}/>:<Target size={24}/>}</span><strong>{habit.title}</strong>
              </button>)}
              <button className="new" onClick={()=>navigate('/modules/goals_habits?new=habit')}><span><Plus size={23}/></span><strong>{t("Новая")}</strong></button>
            </div>
            <LifeLink action={()=>navigate('/modules/goals_habits')}>{t("Цели и привычки")}</LifeLink>
          </LifeCard>}
        </div>
      </div>}
      <div className="life-home-widgets">{selectedWidgets.map(key=>{
        const item=metric(key);
        if(!item)return null;
        const Icon=item.icon;
        return <button className={'life-metric theme-'+item.theme} key={key} onClick={()=>navigate(item.path)}>
          <span className="life-metric-heading"><span><Icon size={17}/></span>{widgetTitles[key]}<ArrowRight size={14}/></span>
          {'bars'in item&&item.bars?.length?<LifeBars values={item.bars} format={v=>formatAmount(v)}/>:null}
          {'progress'in item&&typeof item.progress==='number'&&<progress value={item.progress} max={100} aria-label={widgetTitles[key]}/>}
          <strong>{item.value} <small>{item.unit}</small></strong><span className="life-metric-hint">{item.hint}</span>
        </button>;
      })}</div><button className="life-text-link life-mobile-customize" onClick={()=>setCustomize(true)}><Layers size={16}/>{t("Настроить главную")}</button>
    </>}
    {customize&&<Modal title={t("Настроить главную")} onClose={()=>setCustomize(false)}>
      <div className="modal-body life-widget-options">{(Object.keys(widgetTitles) as HomeWidget[]).filter(key=>!widgets||metric(key)).map(key=><label key={key}>
        <input type="checkbox" checked={selectedWidgets.includes(key)} onChange={()=>toggleWidget(key)}/>{widgetTitles[key]}</label>)}
        <p>{t("Выбор хранится на этом устройстве.")}</p></div>
      <footer className="modal-footer"><button className="button primary" onClick={()=>setCustomize(false)}>{t("Готово")}</button></footer>
    </Modal>}
    {finishEvent&&<ConfirmDialog title={t("Завершить событие раньше?")} description={finishEvent.title} onClose={()=>setFinishEvent(null)}
      onConfirm={async()=>{await api('/planning/events/'+finishEvent.id,{method:'PATCH',body:{version:finishEvent.version,end_at:new Date().toISOString()}});setLiveDetails(false);await refresh();notify(t("Время окончания обновлено"));}}/>}
  </div>;
}
