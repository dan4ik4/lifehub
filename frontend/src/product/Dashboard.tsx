import {useCallback, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowRight, BookOpen, CalendarDays, Check, Heart, Layers, Moon, RefreshCw, Target, Wallet} from 'lucide-react';
import {api, errorMessage} from '../lib/api';
import {dayLabel, todayKey} from '../lib/dates';
import type {CalendarEvent, Notify, Task, TaskOccurrence, User} from '../lib/types';
import {openQuickAdd} from '../lib/workspace';
import {formatAmount} from './format';
import {displayWeight, weightLabel} from './weight';

type DashboardData = {
  day:string;
  widgets:{
    planning?:{tasks:{task:Task;occurrence:TaskOccurrence}[];events:CalendarEvent[]};
    habits?:{id:string;title:string;version:number;today_complete:boolean;target:string;kind:string}[];
    sleep?:{hours:number;end_at?:string;day?:string}|null;
    weight?:{day:string;kg:string}[];
    workouts?:{count:number;minutes:number};
    books?:{id:string;title:string;author:string;cover_id:number|null;current_page:number;total_pages:number|null}[];
    finance?:{currency:string;kind:string;amount:string}[];
  };
};

function Card({title, icon, action, onOpen, children, className=''}: {
  title:string;icon:ReactNode;action:string;onOpen:()=>void;children:ReactNode;className?:string;
}) {
  return <section className={'hub-card '+className}>
    <header><span className="hub-card-icon">{icon}</span><h2>{title}</h2></header>
    <div className="hub-card-body">{children}</div>
    <button className="hub-card-link" onClick={onOpen}>{action}<ArrowRight size={16}/></button>
  </section>;
}

export function Dashboard({user,navigate,notify}: {user:User;navigate:(path:string)=>void;notify:Notify}) {
  const [data,setData] = useState<DashboardData|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [acting,setActing] = useState('');
  const [currency,setCurrency] = useState('');
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
  const time=(stamp:string) => new Date(stamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:user.timezone});
  const events=[...new Map((plans?.events??[]).map(event => [event.id+':'+event.occurrence_at,event])).values()]
    .sort((a,b) => Date.parse(a.start_at)-Date.parse(b.start_at));
  const tasks=[...new Map((plans?.tasks??[]).map(record => [record.task.id+':'+record.occurrence.occurrence_at,record])).values()];
  const nextEvent=events.find(event => !event.all_day && Date.parse(event.start_at)>Date.now());
  const nextTask=tasks.find(({occurrence}) => occurrence.status==='pending');
  const completed=tasks.filter(({occurrence}) => occurrence.status==='completed').length;
  const currencies=[...new Set(widgets?.finance?.map(row => row.currency)??[])];
  const activeCurrency=currencies.includes(currency)?currency:currencies[0];
  const expense=widgets?.finance?.find(row => row.currency===activeCurrency&&row.kind==='expense')?.amount??'0';
  const income=widgets?.finance?.find(row => row.currency===activeCurrency&&row.kind==='income')?.amount??'0';
  const book=widgets?.books?.[0];
  const weight=widgets?.weight?.at(-1);
  const pro=user.plan==='pro'||(user.plan==='trial'&&!!user.trial_ends&&Date.parse(user.trial_ends)>Date.now());
  const eventLink=(event:CalendarEvent) => '/planning/calendar?'+new URLSearchParams({day,event:event.id,...(event.occurrence_at?{occurrence:event.occurrence_at}:{})});
  const taskLink=(task:Task,occurrence:TaskOccurrence) => '/planning?'+new URLSearchParams({day,task:task.id,
    ...(occurrence.occurrence_at?{occurrence:occurrence.occurrence_at}:{})});
  return <div className="hub-home">
    <section className="hub-hero" aria-label="Сегодня">
      <div className="hub-hero-copy">
        <p>{dayLabel(day,{weekday:'long', day:'numeric', month:'long'})}</p>
        <h1>Привет, {user.name?.trim().split(/\s+/)[0] || 'друг'}</h1>
      </div>
      <button className="icon-button hub-hero-refresh" onClick={() => void refresh()} disabled={loading} aria-label="Обновить сводку">
        <RefreshCw size={18} className={loading?'spinner':''}/>
      </button>
      {nextEvent ? <button className="hub-hero-next" onClick={() => navigate(eventLink(nextEvent))}>
        <CalendarDays size={20}/><span><small>Следующее событие · {time(nextEvent.start_at)}</small><strong>{nextEvent.title}</strong></span><ArrowRight size={18}/>
      </button> : nextTask ? <button className="hub-hero-next" onClick={() => navigate(taskLink(nextTask.task,nextTask.occurrence))}>
        <Target size={20}/><span><small>Дальше по плану</small><strong>{nextTask.task.title}</strong></span><ArrowRight size={18}/>
      </button> : null}
    </section>
    {error && <div className="product-error" role="alert">{error}<button className="button secondary" onClick={() => void refresh()}>Повторить</button></div>}
    {!data && loading && <div className="hub-home-grid" role="status" aria-label="Загружаем сводку"><div className="hub-card hub-placeholder"/><div className="hub-card hub-placeholder"/></div>}
    {widgets && <div className="hub-home-grid">
      {plans && <Card title="План на сегодня" icon={<CalendarDays size={20}/>} action="Открыть мой день" onOpen={() => navigate('/planning')} className="hub-plan-card">
        {!!tasks.length && <p className="hub-muted">Выполнено {completed} из {tasks.length} задач</p>}
        {events.slice(0,2).map(event => <button className="hub-event-row" key={event.id+':'+event.occurrence_at} onClick={() => navigate(eventLink(event))}>
          <time>{event.all_day?'Весь день':time(event.start_at)}</time><strong>{event.title}</strong><ArrowRight size={16}/>
        </button>)}
        {tasks.slice().sort((a,b) => Number(a.occurrence.status==='completed')-Number(b.occurrence.status==='completed')).slice(0,4).map(({task,occurrence}) => {
          const done=occurrence.status==='completed';
          return <div className="hub-task-row" key={task.id+':'+occurrence.occurrence_at}>
            <button className="hub-check" aria-label={task.title} role="checkbox" aria-checked={done} disabled={!!acting}
              onClick={() => void mark('/planning/tasks/'+task.id+'/'+(done?'reopen':'complete'),{version:task.version,occurrence_at:occurrence.occurrence_at},task.id)}>
              <span>{done && <Check size={15}/>}</span>
            </button>
            <button className="hub-task-title" onClick={() => navigate(taskLink(task,occurrence))}>{task.title}</button>
          </div>;
        })}
        {!events.length && !tasks.length && <p>На сегодня пока нет планов. <button className="text-button" onClick={() => openQuickAdd('task')}>Добавить задачу</button></p>}
      </Card>}
      {widgets.habits && <Card title="Привычки" icon={<Target size={20}/>} action="Цели и привычки" onOpen={() => navigate('/modules/goals_habits')} className="hub-habits-card">
        {widgets.habits.length ? <>
          <div className="hub-metric">{widgets.habits.filter(habit => habit.today_complete).length}<small> / {widgets.habits.length} сегодня</small></div>
          {widgets.habits.slice(0,2).map(habit => <button className="hub-habit-row" key={habit.id} disabled={!!acting}
            onClick={() => habit.kind==='boolean' ? void mark('/habits/'+habit.id+'/checkins',{version:habit.version,day,value:habit.today_complete?0:habit.target},habit.id) : navigate('/modules/goals_habits')}>
            <span className={'hub-habit-mark '+(habit.today_complete?'complete':'')}>{habit.today_complete?<Check size={14}/>:<span/>}</span>{habit.title}
          </button>)}
        </> : <p>На сегодня нет запланированных привычек.</p>}
      </Card>}
      {widgets.workouts && <Card title="Здоровье" icon={<Heart size={20}/>} action="Показатели здоровья" onOpen={() => navigate('/modules/health')} className="hub-health-card">
        {widgets.sleep ? <><div className="hub-metric">{formatAmount(widgets.sleep.hours)} <small>ч сна</small></div>
          <p className="hub-muted"><Moon size={14}/> Последняя запись{widgets.sleep.day ? ' · '+dayLabel(widgets.sleep.day) : widgets.sleep.end_at ? ' · '+new Date(widgets.sleep.end_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:user.timezone}) : ''}</p></>
          : weight ? <><div className="hub-metric">{formatAmount(displayWeight(weight.kg,user.weight_unit))} <small>{weightLabel(user.weight_unit)}</small></div><p className="hub-muted">Последнее измерение · {dayLabel(weight.day)}</p></>
          : <p>Пока нет записей сна или веса.</p>}
        <p className="hub-muted">Тренировки за неделю · {widgets.workouts.count} · {widgets.workouts.minutes} мин</p>
      </Card>}
      {widgets.finance && <Card title="Финансы" icon={<Wallet size={20}/>} action="Открыть финансы"
        onOpen={() => navigate('/modules/finance'+(activeCurrency?'?currency='+activeCurrency:''))} className="hub-finance-card">
        {activeCurrency ? <>
          <div className="hub-finance-amount"><div><small>Расходы с начала месяца</small><div className="hub-metric">{formatAmount(expense)} <small>{activeCurrency}</small></div></div>
            {currencies.length>1 && <select aria-label="Валюта сводки" value={activeCurrency} onChange={event => setCurrency(event.target.value)}>{currencies.map(code => <option key={code}>{code}</option>)}</select>}
          </div>
          <div className="hub-comparison"><span>Доходы</span><strong>{formatAmount(income)} {activeCurrency}</strong></div>
        </> : <p>Пока нет операций в этом месяце.</p>}
      </Card>}
      {widgets.books && <Card title="Книги" icon={<BookOpen size={20}/>} action={book?'Открыть книгу':'Книжная полка'}
        onOpen={() => navigate('/modules/books/books'+(book?'/'+book.id:''))} className="hub-books-card">
        {book ? <div className="hub-reading"><span className="hub-book-emblem"><BookOpen size={26}/>{book.cover_id && <img alt="" loading="lazy" src={`https://covers.openlibrary.org/b/id/${book.cover_id}-M.jpg`} onError={event => {event.currentTarget.hidden = true;}}/>}</span><div><strong>{book.title}</strong><p>{book.author}</p>
          {book.total_pages ? <progress value={book.current_page} max={book.total_pages} aria-label="Прогресс чтения"/> : null}
          <small>{book.current_page}{book.total_pages?' / '+book.total_pages:''} стр.</small></div></div>
        : <p>Пока нет книг в чтении.</p>}
      </Card>}
      {pro && <Card title="Что видно вместе" icon={<Layers size={20}/>} action="Открыть обзор" onOpen={() => navigate('/modules/insights')} className="hub-insights-card">
        <p>Сравните записи из разных модулей за один период.</p>
      </Card>}
    </div>}
  </div>;
}
