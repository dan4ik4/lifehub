import { t } from '../lib/language';
import { financeGroup } from '../product/financeNavigation';
import { listDisplayName } from '../lib/workspace';
import {useEffect, useRef, useState} from 'react';
import {
  Activity, Apple, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, Clock3,
  Grid2X2, Heart, Home, Layers, Leaf, Link2, ListChecks, ListFilter, Moon, Pencil,
  Pill, Plus, Scale, Search, Settings2, Sparkles, Sun, Target, UserRound, Wallet, X,
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
  {id:'home', title:t("Сегодня"), short:t("Сегодня"), to:'/home', icon:Home},
  {id:'plans', title:t("Планирование"), short:t("Планы"), to:'/planning', icon:CalendarDays},
  {id:'habits', title:t("Цели и привычки"), short:t("Привычки"), to:'/modules/goals_habits', icon:Target},
  {id:'health', title:t("Здоровье"), short:t("Здоровье"), to:'/modules/health', icon:Heart},
  {id:'finance', title:t("Финансы"), short:t("Финансы"), to:'/modules/finance', icon:Wallet},
  {id:'books', title:t("Книги и дневник"), short:t("Книги"), to:'/modules/books', icon:BookOpen},
  {id:'insights', title:t("Что видно вместе"), short:t("Обзор"), to:'/modules/insights', icon:Sparkles},
] as const;
const moduleLinks:Record<string,[string,string,LucideIcon][]> = {
  plans:[[t("Мой день"),'',Sun],[t("Календарь"),'calendar',CalendarDays],[t("Свободное время"),'free-time',Clock3],[t("Списки"),'lists',ListChecks]],
  habits:[[t("Сегодня"),'',Sun],[t("Привычки"),'habits',Target],[t("Цели"),'goals',Layers],[t("Статистика"),'stats',ChartNoAxesColumnIncreasing]],
  health:[[t("Обзор"),'',Heart],[t("Сон"),'sleep',Moon],[t("Вес"),'weight',Scale],[t("Тренировки"),'workouts',Activity],[t("Программы"),'programs',ListChecks],[t("Питание"),'nutrition',Apple],[t("Лекарства"),'medications',Pill]],
  finance:[[t("Обзор"),'',Wallet],[t("Операции"),'transactions',ListFilter],[t("Бюджеты"),'budgets',ChartNoAxesColumnIncreasing],[t("Накопления"),'savings',Layers],[t("Долги"),'debts',Wallet]],
  books:[[t("Книжная полка"),'',BookOpen],[t("Дневник"),'diary',Pencil]],
  insights:[[t("Обзор"),'',Sparkles],[t("Все сравнения"),'comparisons',ChartNoAxesColumnIncreasing],[t("Разборы ИИ"),'review',Activity]],
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
          return {day,title:count?count+t(" в календаре"):t("Нет событий")};
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
  if (active.id==='plans' && onConnections) links.push({label:t("Подключения"),icon:Link2,action:onConnections});
  if (active.id==='home') links.push(
    {label:t("Обзор дня"),icon:Home,to:'/home'},
    {label:t("Итоги недели"),icon:ChartNoAxesColumnIncreasing,to:'/modules/insights'},
    {label:t("Настроить главную"),icon:Layers,action:()=>window.dispatchEvent(new Event('lifehub:customize-home'))},
  );
  const financeSection=active.id==='finance'?financeGroup(path.split('/')[3])[0]:undefined;
  const alias=financeSection?active.to+(financeSection==='overview'?'':'/'+financeSection):path.replace(/\/overview$/,'').replace(/\/modules\/books\/books$/,'/modules/books');
  return <>
    <aside className="life-rail" aria-label={t("Основная навигация")}>
      <button className="life-brand" onClick={()=>go('/home')} aria-label={t("LifeHub — главная")}><Leaf size={22}/></button>
      <nav aria-label={t("Разделы LifeHub")}>
        {modules.map(({id,short,to,icon:Icon})=><button key={id} className={'life-rail-button theme-'+id} aria-label={short}
          aria-current={id===active.id?'true':undefined} onClick={()=>go(to)}><span><Icon size={21}/></span><small>{short}</small></button>)}
      </nav>
      <div className="life-rail-foot">
        <button className="life-rail-button" onClick={()=>openAssistant()} aria-label={t("Открыть чат с помощником")}>
          <span className="life-rail-ai"><Sparkles size={21}/></span><small>{t("ИИ")}</small>
        </button>
        <button className="life-rail-settings" onClick={onSettings} aria-label={t("Настройки")}><Settings2 size={19}/></button>
        <button className="life-rail-avatar" onClick={onSettings} aria-label={t("Настройки профиля")}><Avatar user={user}/></button>
      </div>
    </aside>
    <aside className={'life-context theme-'+active.id} aria-label={t("Навигация: ")+active.title}>
      <header><strong>{active.title}</strong>{active.id!=='home'&&<small>{active.id==='plans'?t("Расписание, задачи и списки"):active.id==='health'?t("Показатели и записи"):active.id==='finance'?t("Операции и бюджеты"):active.id==='books'?t("Чтение и дневник"):active.id==='habits'?t("Прогресс и цели"):t("Наблюдения по записям")}</small>}</header>
      <button className="life-context-search" onClick={chooseSearch}><Search size={15}/>{t("Поиск")}<kbd>⌘K</kbd></button>
      <nav className="life-context-links" aria-label={active.title}>
        {links.map(({label,icon:Icon,to,action})=>{
          const selected=to&&(alias===to||(to!==active.to&&alias.startsWith(to+'/')));
          return <button key={label} aria-current={selected?'page':undefined} onClick={to?()=>go(to):action}><Icon size={16}/>{label}</button>;
        })}
      </nav>
      {active.id==='home'&&(homeLists.length>0||reading)&&<details open className="life-context-pins"><summary>{t("Закреплено")}</summary>
        {homeLists.map(list=><button key={list.id} onClick={()=>go('/planning/lists?list='+encodeURIComponent(list.id))}><i/>{listDisplayName(list)}<small>{list.item_count}</small></button>)}
        {reading&&<button onClick={()=>go('/modules/books/books/'+reading.id)}><BookOpen size={15}/>{reading.title}
          {reading.total_pages&&<small>{Math.round(100*reading.current_page/reading.total_pages)}%</small>}</button>}
      </details>}
      {active.id==='home'&&upcoming.length>0&&<details open className="life-context-pins"><summary>{t("Ближайшие дни")}</summary>
        {upcoming.map(({day,title})=><button key={day} onClick={()=>go('/planning/calendar?day='+day)}>
          <strong>{dayLabel(day,{weekday:'short',day:'numeric'})}</strong><small>{title}</small>
        </button>)}
      </details>}
      {active.id==='plans' && lists.length>0 && <section className="life-context-pins"><h2>{t("Мои списки")}</h2>
        {lists.map(list=><button key={list.id} onClick={()=>go('/planning/lists?list='+encodeURIComponent(list.id))}>
          <i/>{listDisplayName(list)}<small>{list.item_count}</small>
        </button>)}
      </section>}
      {context}
    </aside>
    <nav className="hub-mobile-nav life-tab-bar" aria-label={t("Мобильная навигация")}>
      <button aria-current={active.id==='home'?'page':undefined} onClick={()=>go('/home')}><Home size={22}/><span>{t("Сегодня")}</span></button>
      <button aria-current={active.id==='plans'?'page':undefined} onClick={()=>go('/planning')}><CalendarDays size={22}/><span>{t("Планы")}</span></button>
      <button className="hub-mobile-add" onClick={()=>openQuickAdd()} aria-label={t("Добавить")}><Plus size={24}/></button>
      <button aria-current={!['home','plans'].includes(active.id)?'page':undefined} aria-expanded={open} onClick={()=>setOpen(true)}><Grid2X2 size={22}/><span>{t("Модули")}</span></button>
      <button aria-haspopup="dialog" aria-label={t("Открыть чат с помощником")} onClick={()=>openAssistant()}><Sparkles size={22}/><span>{t("ИИ")}</span></button>
      <button onClick={onSettings} aria-haspopup="dialog"><UserRound size={22}/><span>{t("Профиль")}</span></button>
    </nav>
    {open && <dialog className="life-module-sheet" ref={sheet} aria-labelledby="life-module-title" onCancel={e=>{e.preventDefault();setOpen(false);}}
      onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <div className="life-module-body"><header><h2 id="life-module-title">{t("Модули")}</h2><button className="icon-button" onClick={()=>setOpen(false)} aria-label={t("Закрыть меню")}><X size={20}/></button></header>
        <nav aria-label={t("Модули")}>{modules.slice(1).map(({id,title,to,icon:Icon})=><button className={'theme-'+id} key={id} onClick={()=>go(to)}>
          <span><Icon size={23}/></span><strong>{title}</strong>
        </button>)}</nav>
      </div>
    </dialog>}
  </>;
}
