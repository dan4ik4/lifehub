import {useEffect, useRef, useState} from 'react';
import {BookOpen, CalendarDays, ChevronRight, Heart, Home, ListChecks, Menu, Settings2, Sun, Target, Wallet, X} from 'lucide-react';
import type {User} from '../lib/types';
import {Logo} from './ui';
import {Avatar} from './Avatar';

export function Navigation({user, path, navigate, onSettings}: {user: User; path: string; navigate: (path: string) => void; onSettings: () => void}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {setOpen(false);}, [path]);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background=panel.current?.parentElement?.querySelector('.app-main');
    background?.setAttribute('inert','');
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const controls = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    };
    window.addEventListener('keydown', key);
    return () => {document.body.style.overflow = overflow; background?.removeAttribute('inert'); window.removeEventListener('keydown', key); trigger.current?.focus();};
  }, [open]);
  const go = (to: string) => {setOpen(false); navigate(to);};
  const planning = path.startsWith('/planning');
  return <>
    <button ref={trigger} className="icon-button global-menu" aria-label="Открыть навигацию" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22}/></button>
    {open && <button className="sidebar-scrim" aria-label="Закрыть навигацию" onClick={() => setOpen(false)}/>}
    <aside ref={panel} className={`sidebar unified-sidebar ${open ? 'is-open' : ''}`} aria-label="Основная навигация" role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}>
      <div className="nav-brand-row"><button className="brand-button" aria-label="Life Hub — главная" onClick={() => go('/home')}><Logo/></button><button className="icon-button nav-close" aria-label="Закрыть меню" onClick={() => setOpen(false)}><X size={20}/></button></div>
      <div className="workspace-label"><span className="workspace-avatar"><Avatar user={user}/></span><div><strong>Моё пространство</strong><small>Всё важное — рядом.</small></div></div>
      <nav className="main-nav"><button className={path === '/home' || path === '/' ? 'active' : ''} aria-current={path === '/home' || path === '/' ? 'page' : undefined} onClick={() => go('/home')}><Home size={19}/><span>Главная</span></button></nav>
      <div className="nav-section-label modules-label">МОДУЛИ</div>
      <nav className="main-nav" aria-label="Модули">
        <button className={planning ? 'active' : ''} aria-current={planning ? 'true' : undefined} onClick={() => go('/planning')}><CalendarDays size={19}/><span>Планирование</span><ChevronRight size={15}/></button>
        {planning && <div className="planning-subnav">{[{path:'/planning',label:'Мой день',icon:Sun},{path:'/planning/calendar',label:'Календарь',icon:CalendarDays},{path:'/planning/lists',label:'Списки',icon:ListChecks}].map(({path:to,label,icon:Icon}) => <button key={to} aria-current={path === to ? 'page' : undefined} className={path === to ? 'selected' : ''} onClick={() => go(to)}><Icon size={16}/>{label}</button>)}</div>}
        {[{key:'goals_habits',label:'Цели и привычки',icon:Target},{key:'health',label:'Здоровье',icon:Heart},{key:'finance',label:'Финансы',icon:Wallet},{key:'books',label:'Книги и дневник',icon:BookOpen}].map(({key,label,icon:Icon}) => <button key={key} className={path === '/modules/'+key ? 'active' : ''} aria-current={path === '/modules/'+key ? 'page' : undefined} onClick={() => go('/modules/'+key)}><Icon size={19}/><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="nav-note">Меньше суеты.<br/><strong>Больше своего ритма.</strong></div><button className="sidebar-settings" onClick={() => {setOpen(false); onSettings();}}><Settings2 size={18}/>Настройки</button><button className="profile-button" onClick={() => {setOpen(false); onSettings();}}><span className="profile-avatar"><Avatar user={user}/></span><span><strong>{user.name || 'Ваш профиль'}</strong><small>Life Hub · {user.plan === 'pro' ? 'Pro' : user.plan === 'trial' && user.trial_ends && Date.parse(user.trial_ends)>Date.now() ? 'Пробный период' : 'Free'}</small></span><ChevronRight size={16}/></button></div>
    </aside>
  </>;
}
