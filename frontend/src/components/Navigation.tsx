import {useEffect, useRef, useState} from 'react';
import {
  Activity, Apple, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, Clock3,
  Grid2X2, Heart, Home, Layers, Leaf, Link2, ListChecks, ListFilter, Moon, Pencil,
  Pill, Plus, Scale, Search, Settings2, Sparkles, Sun, Target, TrendingUp, UserRound, Wallet, X,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import type {CalendarRange,PlanningList,User} from '../lib/types';
import {api,isDemo} from '../lib/api';
import {dateKey,dayLabel,shiftDay,startOfDay,todayKey} from '../lib/dates';
import {Avatar} from './Avatar';
import {openAssistant, openQuickAdd} from '../lib/workspace';

type Link = {label:string; icon:LucideIcon; to?:string; action?:()=>void};
const modules = [
  {id:'home', title:'Сегодня', short:'Сегодня', to:'/home', icon:Home},
  {id:'plans', title:'Планирование', short:'Планы', to:'/planning', icon:CalendarDays},
  {id:'habits', title:'Цели и привычки', short:'Привычки', to:'/modules/goals_habits', icon:Target},
  {id:'health', title:'Здоровье', short:'Здоровье', to:'/modules/health', icon:Heart},
  {id:'finance', title:'Финансы', short:'Финансы', to:'/modules/finance', icon:Wallet},
  {id:'books', title:'Книги и дневник', short:'Книги', to:'/modules/books', icon:BookOpen},
  {id:'insights', title:'Что видно вместе', short:'Обзор', to:'/modules/insights', icon:Sparkles},
] as const;
const moduleLinks:Record<string,[string,string,LucideIcon][]> = {
  plans:[['Мой день','',Sun],['Календарь','calendar',CalendarDays],['Свободное время','free-time',Clock3],['Списки','lists',ListChecks]],
  habits:[['Сегодня','',Sun],['Привычки','habits',Target],['Цели','goals',Layers],['Статистика','stats',ChartNoAxesColumnIncreasing]],
  health:[['Обзор','',Heart],['Сон','sleep',Moon],['Вес','weight',Scale],['Тренировки','workouts',Activity],['Программы','programs',ListChecks],['Питание','nutrition',Apple],['Лекарства','medications',Pill]],
  finance:[['Обзор','',Wallet],['Операции','transactions',ListFilter],['Бюджеты','budgets',ChartNoAxesColumnIncreasing],['Подписки','subscriptions',Clock3],['Накопления','savings',Layers],['На мечту','saving-goals',Sparkles],['Долги','debts',Wallet],['Аналитика','analysis',TrendingUp]],
  books:[['Книжная полка','',BookOpen],['Дневник','diary',Pencil]],
  insights:[['Обзор','',Sparkles],['Все сравнения','comparisons',ChartNoAxesColumnIncreasing],['Разборы ИИ','review',Activity]],
};

export function Navigation({user,path,navigate,onSettings,onConnections,onSearch,lists=[],context}: {
  user:User; path:string; navigate:(path:string)=>void; onSettings:()=>void; onConnections?:()=>void;
  onSearch?:()=>void; lists?:PlanningList[]; context?:ReactNode;
}) {
  const [open,setOpen]=useState(false);
  const [homeLists,setHomeLists]=useState<PlanningList[]>([]);
  const [upcoming,setUpcoming]=useState<{day:string;title:string}[]>([]);
  const [reading,setReading]=useState<{id:string;title:string;current_page:number;total_pages:number|null}|null>(null);
  const sheet=useRef<HTMLDialogElement>(null);
  const active=modules.find(module => path===module.to || path.startsWith(module.to+'/'))??modules[0];
  const date = new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',timeZone:user.timezone}).format(new Date());
  const go = (to:string) => {setOpen(false); navigate(to);};
  const chooseSearch = () => onSearch ? onSearch() : go('/planning?find=1');
  useEffect(()=>{
    if(active.id!=='home'||isDemo())return;
    const today=todayKey(user.timezone),start=shiftDay(today,1);
    const pro=user.plan==='pro'||(user.plan==='trial'&&Date.parse(user.trial_ends??'')>Date.now());
    const controller=new AbortController(),signal=controller.signal;
    if(pro||user.free_modules.includes('planning')){
      api<{items:PlanningList[]}>('/planning/lists',{signal}).then(data=>{if(!signal.aborted)setHomeLists(data.items.slice(0,3));}).catch(()=>{});
      api<CalendarRange>('/planning/calendar?'+new URLSearchParams({from:startOfDay(start,user.timezone),to:startOfDay(shiftDay(start,3),user.timezone),timezone:user.timezone}),{signal})
        .then(data=>{if(!signal.aborted)setUpcoming(Array.from({length:3},(_,i)=>{
          const day=shiftDay(start,i),count=data.events.filter(event=>dateKey(event.start_at,event.all_day?event.timezone:user.timezone)===day).length;
          return {day,title:count?count+' в календаре':'Нет событий'};
        }));}).catch(()=>{});
    }
    if(pro||user.free_modules.includes('books'))api<{items:NonNullable<typeof reading>[]}>('/books?status=reading&limit=1',{signal})
      .then(data=>{if(!signal.aborted)setReading(data.items[0]??null);}).catch(()=>{});
    return ()=>controller.abort();
  },[active.id,user.id,user.plan,user.trial_ends,user.timezone,user.free_modules]);
  useEffect(() => {setOpen(false);},[path]);
  useEffect(() => {
    if (!open) return;
    const dialog=sheet.current;
    const focus=document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (focus instanceof HTMLElement) focus.focus({preventScroll:true});
    };
  }, [open]);

  const links:Link[] = (moduleLinks[active.id]??[]).map(([label,suffix,icon])=>({label,icon,to:active.to+(suffix?'/'+suffix:'')}));
  if (active.id==='plans' && onConnections) links.push({label:'Подключения',icon:Link2,action:onConnections});
  if (active.id==='home') links.push(
    {label:'Обзор дня',icon:Home,to:'/home'},
    {label:'Итоги недели',icon:ChartNoAxesColumnIncreasing,to:'/modules/insights'},
    {label:'Настроить главную',icon:Layers,action:()=>window.dispatchEvent(new Event('lifehub:customize-home'))},
  );
  const alias=path.replace(/\/overview$/,'').replace(/\/modules\/books\/books$/,'/modules/books');
  return <>
    <aside className="life-rail" aria-label="Основная навигация">
      <button className="life-brand" onClick={()=>go('/home')} aria-label="LifeHub — главная"><Leaf size={22}/></button>
      <nav aria-label="Разделы LifeHub">
        {modules.map(({id,short,to,icon:Icon})=><button key={id} className={'life-rail-button theme-'+id} aria-label={short}
          aria-current={id===active.id?'true':undefined} onClick={()=>go(to)}><span><Icon size={21}/></span><small>{short}</small></button>)}
      </nav>
      <div className="life-rail-foot">
        <button className="life-rail-button" onClick={()=>openAssistant()} aria-label="Открыть чат с помощником">
          <span className="life-rail-ai"><Sparkles size={21}/></span><small>ИИ</small>
        </button>
        <button className="life-rail-settings" onClick={onSettings} aria-label="Настройки"><Settings2 size={19}/></button>
        <button className="life-rail-avatar" onClick={onSettings} aria-label="Настройки профиля"><Avatar user={user}/></button>
      </div>
    </aside>
    <aside className={'life-context theme-'+active.id} aria-label={'Навигация: '+active.title}>
      <header><strong>{active.title}</strong><small>{active.id==='home'?date:active.id==='plans'?'Расписание, задачи и списки':active.id==='health'?'Показатели и записи':active.id==='finance'?'Операции и бюджеты':active.id==='books'?'Чтение и дневник':active.id==='habits'?'Прогресс и цели':'Наблюдения по записям'}</small></header>
      <button className="life-context-search" onClick={chooseSearch}><Search size={15}/>Поиск<kbd>⌘K</kbd></button>
      <nav className="life-context-links" aria-label={active.title}>
        {links.map(({label,icon:Icon,to,action})=>{
          const selected=to&&(alias===to||(to!==active.to&&alias.startsWith(to+'/')));
          return <button key={label} aria-current={selected?'page':undefined} onClick={to?()=>go(to):action}><Icon size={16}/>{label}</button>;
        })}
      </nav>
      {active.id==='home'&&(homeLists.length>0||reading)&&<section className="life-context-pins"><h2>Закреплено</h2>
        {homeLists.map(list=><button key={list.id} onClick={()=>go('/planning/lists?list='+encodeURIComponent(list.id))}><i/>{list.name}<small>{list.item_count}</small></button>)}
        {reading&&<button onClick={()=>go('/modules/books/books/'+reading.id)}><BookOpen size={15}/>{reading.title}
          {reading.total_pages&&<small>{Math.round(100*reading.current_page/reading.total_pages)}%</small>}</button>}
      </section>}
      {active.id==='home'&&upcoming.length>0&&<section className="life-context-pins"><h2>Ближайшие дни</h2>
        {upcoming.map(({day,title})=><button key={day} onClick={()=>go('/planning/calendar?day='+day)}>
          <strong>{dayLabel(day,{weekday:'short',day:'numeric'})}</strong><small>{title}</small>
        </button>)}
      </section>}
      {active.id==='plans' && lists.length>0 && <section className="life-context-pins"><h2>Мои списки</h2>
        {lists.map(list=><button key={list.id} onClick={()=>go('/planning/lists?list='+encodeURIComponent(list.id))}>
          <i/>{list.name}<small>{list.item_count}</small>
        </button>)}
      </section>}
      {context}
    </aside>
    <nav className="hub-mobile-nav life-tab-bar" aria-label="Мобильная навигация">
      <button aria-current={active.id==='home'?'page':undefined} onClick={()=>go('/home')}><Home size={22}/><span>Сегодня</span></button>
      <button aria-current={active.id==='plans'?'page':undefined} onClick={()=>go('/planning')}><CalendarDays size={22}/><span>Планы</span></button>
      <button className="hub-mobile-add" onClick={()=>openQuickAdd()} aria-label="Добавить"><Plus size={24}/></button>
      <button aria-current={!['home','plans'].includes(active.id)?'page':undefined} aria-expanded={open} onClick={()=>setOpen(true)}><Grid2X2 size={22}/><span>Модули</span></button>
      <button onClick={onSettings}><UserRound size={22}/><span>Профиль</span></button>
    </nav>
    {open && <dialog className="life-module-sheet" ref={sheet} aria-labelledby="life-module-title" onCancel={e=>{e.preventDefault();setOpen(false);}}
      onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <div className="life-module-body"><header><h2 id="life-module-title">Модули</h2><button className="icon-button" onClick={()=>setOpen(false)} aria-label="Закрыть меню"><X size={20}/></button></header>
        <nav aria-label="Модули">{modules.slice(1).map(({id,title,to,icon:Icon})=><button className={'theme-'+id} key={id} onClick={()=>go(to)}>
          <span><Icon size={23}/></span><strong>{title}</strong>
        </button>)}</nav>
        <button className="life-sheet-assistant" onClick={()=>{setOpen(false);openAssistant();}}><Sparkles size={19}/>Спросить помощника</button>
      </div>
    </dialog>}
  </>;
}
