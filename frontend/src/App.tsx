import {Avatar} from './components/Avatar';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Crown, Heart, HelpCircle, LayoutGrid, Link2, ListChecks, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Search, Settings2, Sparkles, Sun, Target, Wallet, X } from 'lucide-react';
import { api, clearSession, errorMessage, getSession, isDemo, setSession, startDemo, subscribeSession } from './lib/api';
import { dateKey, dayLabel, monthDays, shiftDay, todayKey } from './lib/dates';
import { allPages, usePlanning } from './lib/usePlanning';
import type { AuthSession, CalendarEvent, Notify, Task, TaskOccurrence, User } from './lib/types';
import { AuthScreen, Onboarding } from './components/Auth';
import { disablePush } from './lib/push';
import { Settings } from './components/Settings';
import { Product, isPro } from './product/Product';
import { Logo, Modal, ConfirmDialog, EmptyState } from './components/ui';
import { TodayView } from './components/TodayView';
import { CalendarView } from './components/CalendarView';
import { ListsView } from './components/ListsView';
import { EntityEditor } from './components/EntityEditor';
import { EventDetails, TaskDetails } from './components/Details';

type View = 'day' | 'calendar' | 'lists';
interface Toast { id: number; message: string; kind: 'success' | 'error' | 'info' }
const viewPaths = { day: '/planning', calendar: '/planning/calendar', lists: '/planning/lists' };
const viewFromPath = (path: string): View => path === viewPaths.calendar ? 'calendar' : path === viewPaths.lists ? 'lists' : 'day';

export default function App() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [path, setPath] = useState(window.location.pathname), [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0), timers = useRef<number[]>([]);
  const notify: Notify = useCallback((message, kind = 'success') => { const id = ++toastId.current; setToasts(old => [...old.slice(-2), { id, message, kind }]); timers.current.push(window.setTimeout(() => setToasts(old => old.filter(t => t.id !== id)), kind === 'error' ? 8000 : 4500)); }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const navigate = useCallback((value: string, replace = false) => { if (replace) window.history.replaceState({}, '', value); else window.history.pushState({}, '', value); setPath(value); }, []);
  useEffect(() => { const pop = () => setPath(window.location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [path]);
  const updateUser = useCallback((user: User) => { const current = getSession(); if (current) setSession({ ...current, user }); }, []);
  useEffect(() => {
    if (!session) return; const controller = new AbortController();
    api<User>('/users/me', { signal: controller.signal }).then(user => { if (!controller.signal.aborted) updateUser(user); }).catch(error => { if (!controller.signal.aborted && getSession()) notify(errorMessage(error), 'error'); });
    return () => controller.abort();
  }, [session?.user.id, notify, updateUser]);
  const onAuthenticated = (value: AuthSession) => { setSession(value); if (window.location.pathname !== '/calendar/callback') navigate('/home', true); };
  const logout = useCallback(async () => {
    const current = getSession();
    try { if (current && !current.demo) await disablePush().catch(() => {}); if (current && !current.demo) await api('/auth/logout', { method: 'POST', body: { refresh_token: current.tokens.refresh_token } }); }
    catch { notify('Вход на этом устройстве закрыт. Сервер не ответил на запрос завершения сессии.', 'info'); }
    finally { clearSession(); navigate('/', true); }
  }, [navigate, notify]);
  return <>
    {!session ? <AuthScreen onAuthenticated={onAuthenticated} onDemo={() => { startDemo(); navigate('/planning', true); }} /> : !session.user.onboarding_completed ? <Onboarding user={session.user} onComplete={user => { updateUser(user); navigate('/home', true); }} onLogout={() => void logout()} /> : path === '/calendar/callback' ? <CalendarCallback onComplete={() => navigate('/planning/calendar', true)} notify={notify} /> : (path === '/home' || path.startsWith('/modules/') || (!isPro(session.user) && !session.user.free_modules.includes('planning'))) ? <Product user={session.user} module={path.startsWith('/modules/') ? path.split('/')[2] : 'dashboard'} navigate={navigate} onUserChange={updateUser} onLogout={() => void logout()} notify={notify} /> : <Workspace navigateProduct={navigate} user={session.user} view={viewFromPath(path)} setView={view => navigate(viewPaths[view])} onUserChange={updateUser} onLogout={() => void logout()} notify={notify} />}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">{toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.kind === 'error' ? <CircleAlert size={18} /> : toast.kind === 'success' ? <CheckCircle2 size={18} /> : <Bell size={18} />}<span>{toast.message}</span><button className="icon-button small" aria-label="Закрыть уведомление" onClick={() => setToasts(old => old.filter(t => t.id !== toast.id))}><X size={15} /></button></div>)}</div>
  </>;
}

function Workspace({ navigateProduct, user, view, setView, onUserChange, onLogout, notify }: { navigateProduct: (path: string) => void; user: User; view: View; setView: (view: View) => void; onUserChange: (user: User) => void; onLogout: () => void; notify: Notify }) {
  const [selected, setSelected] = useState(todayKey(user.timezone));
  const [editor, setEditor] = useState<{ kind: 'task' | 'event'; item?: Task | CalendarEvent; day: string; time?: string } | null>(null);
  const [settings, setSettings] = useState<'profile' | 'connections' | 'plan' | null>(null), [mobileNav, setMobileNav] = useState(false), [search, setSearch] = useState(false), [help, setHelp] = useState(false), [createMenu, setCreateMenu] = useState(false);
  const [eventDetails, setEventDetails] = useState<CalendarEvent | null>(null), [taskDetails, setTaskDetails] = useState<{ task: Task; occurrence?: TaskOccurrence } | null>(null), [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]), lock = useRef(new Set<string>()), menuRef = useRef<HTMLDivElement>(null);
  const month = monthDays(selected), data = usePlanning(user.timezone, month[0], shiftDay(month.at(-1)!, 1));
  const pro = user.plan === 'pro' || (user.plan === 'trial' && Boolean(user.trial_ends) && Date.parse(user.trial_ends!) > Date.now());
  const title = { day: 'Мой день', calendar: 'Календарь', lists: 'Мои списки' }[view];
  const firstName = user.name?.trim().split(' ')[0] || 'друг';
  const createTask = () => { setEditor({ kind: 'task', day: selected }); setCreateMenu(false); };
  const createEvent = (day = selected, time?: string) => { setEditor({ kind: 'event', day, time }); setCreateMenu(false); };
  const editTask = (task: Task) => setEditor({ kind: 'task', item: task, day: selected });
  const navigate = (view: View) => { setView(view); setMobileNav(false); };
  useEffect(() => {
    if (!mobileNav) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.querySelector<HTMLButtonElement>('.sidebar .brand-button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', trap); previousFocus?.focus(); };
  }, [mobileNav]);
  useEffect(() => { document.title = `${title} · Life Hub`; }, [title]);
  useEffect(() => { const keydown = (e: KeyboardEvent) => { const input = e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable); if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } else if (e.key === 'Escape') { setCreateMenu(false); setMobileNav(false); } else if (!input && !document.querySelector('dialog[open]') && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor({ kind: 'task', day: selected }); } }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, [selected]);
  useEffect(() => { if (!createMenu) return; const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setCreateMenu(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [createMenu]);
  async function toggleTask(task: Task, occurrence?: TaskOccurrence) {
    if (lock.current.has(task.id)) return;
    lock.current.add(task.id); setBusyIds([...lock.current]);
    const completed = occurrence ? occurrence.status === 'completed' : task.completed;
    try {
      const occurrence_at = task.recurrence ? occurrence?.occurrence_at || task.next_occurrence_at : null;
      if (task.recurrence && !occurrence_at) throw new Error('У этой серии нет следующего повторения. Выберите дату в календаре.');
      await api(`/planning/tasks/${task.id}/${completed ? 'reopen' : 'complete'}`, { method: 'POST', body: { occurrence_at, version: task.version } });
      await data.refresh(); setTaskDetails(null); notify(completed ? 'Задача снова в планах' : 'Ещё одно дело позади. Отлично!');
    } catch (e) { notify(errorMessage(e), 'error'); await data.refresh(); }
    finally { lock.current.delete(task.id); setBusyIds([...lock.current]); }
  }
  const afterSaved = () => { void data.refresh(); notify(editor?.item ? 'Изменения сохранены' : editor?.kind === 'event' ? 'Событие добавлено в календарь' : 'Задача добавлена'); };
  return <div className="app-layout">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    {mobileNav && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Основная навигация"><button className="brand-button" onClick={() => navigate('day')} aria-label="Life Hub — мой день"><Logo /></button><div className="workspace-label"><span className="workspace-avatar"><Avatar user={user}/></span><div><strong>Личное пространство</strong><small>Ваш ритм. Ваши планы.</small></div></div>
      <div className="nav-section-label">МОЁ ПРОСТРАНСТВО</div><nav className="main-nav">{([{ key: 'day', label: 'Мой день', icon: Sun }, { key: 'calendar', label: 'Календарь', icon: CalendarDays }, { key: 'lists', label: 'Списки', icon: ListChecks }] as const).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={19} strokeWidth={1.8} /><span>{label}</span>{key === 'day' && data.tasks.filter(t => !t.completed).length > 0 && <span className="nav-count">{data.tasks.filter(t => !t.completed).length}</span>}</button>)}</nav>
      <div className="nav-section-label modules-label">МОДУЛИ<span>05 / 05</span></div><nav className="main-nav"><button onClick={()=>navigateProduct('/home')}><LayoutGrid size={18}/><span>Общая сводка</span></button>{[{key:'goals_habits',label:'Цели и привычки',icon:Target},{key:'health',label:'Здоровье',icon:Heart},{key:'finance',label:'Финансы',icon:Wallet},{key:'books',label:'Книги и дневник',icon:BookOpen}].map(({key,label,icon:Icon})=><button key={key} onClick={()=>navigateProduct('/modules/'+key)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom">{isDemo() ? <div className="sidebar-demo"><span><Sparkles size={16} />Демо-пространство</span><p>Попробуйте всё в своём темпе. Изменения останутся в этом браузере.</p><button onClick={onLogout}>Перейти ко входу<ArrowRight size={14} /></button></div> : !pro ? <button className="sidebar-plan" onClick={() => setSettings('plan')}><span><Sparkles size={18} />Больше возможностей</span><p>Повторы, приоритеты<br />и все ваши календари.</p><span className="plan-link">Посмотреть Pro<ArrowRight size={14} /></span></button> : <button className="sidebar-plan compact" onClick={() => setSettings('plan')}><Crown size={17} />{user.plan === 'trial' ? 'Ваш пробный период' : 'Life Hub Pro'}<ChevronRight size={15} /></button>}
        <button className="sidebar-settings" onClick={() => setSettings('profile')}><Settings2 size={18} />Настройки</button><button className="profile-button" onClick={() => setSettings('profile')}><span className="profile-avatar"><Avatar user={user}/></span><span><strong>{user.name || 'Ваш профиль'}</strong><small>{isDemo() ? 'Демонстрационный аккаунт' : user.plan === 'free' ? 'План Free' : user.plan === 'trial' ? 'Пробный период' : 'План Pro'}</small></span><ChevronDown size={16} /></button>
      </div></aside>
    <div className="app-main" inert={mobileNav}><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>Моё пространство</span><ChevronRight size={13} /><strong>Планирование</strong></div><div className="topbar-actions"><button className="search-trigger" aria-label="Найти в планах" onClick={() => setSearch(true)}><Search size={17} /><span>Найти в планах</span><kbd>⌘ K</kbd></button><span className="topbar-divider" /><button className="icon-button" aria-label="Подключения календарей" title="Подключения календарей" onClick={() => setSettings('connections')}><Link2 size={19} /></button><button className="icon-button" aria-label="Помощь и горячие клавиши" title="Помощь" onClick={() => setHelp(true)}><HelpCircle size={19} /></button><button className="header-avatar" aria-label="Мой профиль" onClick={() => setSettings('profile')}><Avatar user={user}/></button></div></header>
      <main id="main-content" className={`workspace-content view-${view}`}><header className="page-header"><div><div className="page-eyebrow"><span>{dayLabel(todayKey(user.timezone), { weekday: 'long', day: 'numeric', month: 'long' })}</span>{isDemo() && <span className="demo-badge">Демо</span>}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{view === 'day' ? `Привет, ${firstName}. Давайте найдём время для важного.` : view === 'calendar' ? 'У каждого важного дела — своё время.' : 'От покупок до идей. Ничего не потеряется.'}</p></div><div className="page-actions"><button className="icon-button refresh-button" onClick={() => void data.refresh()} aria-label="Обновить данные" disabled={data.refreshing || data.loading}><RefreshCw size={17} className={data.refreshing ? 'spinner' : ''} /></button><div className="create-menu-wrap" ref={menuRef}><div className="split-button"><button className="button primary" onClick={view === 'calendar' ? () => createEvent() : createTask}><Plus size={17} />{view === 'calendar' ? 'Новое событие' : 'Новая задача'}</button><button className="split-trigger" aria-label="Другие способы добавления" aria-expanded={createMenu} onClick={() => setCreateMenu(!createMenu)}><ChevronDown size={16} /></button></div>{createMenu && <div className="action-menu create-menu"><button onClick={createTask}><CheckCircle2 size={16} />Создать задачу<kbd>N</kbd></button><button onClick={() => createEvent()}><CalendarDays size={16} />Создать событие</button><button onClick={() => { navigate('lists'); setCreateMenu(false); }}><ListChecks size={16} />Открыть списки</button></div>}</div></div></header>
      {data.error && <div className="workspace-error" role="alert"><CircleAlert size={19} /><div><strong>Не удалось обновить планы</strong><p>{data.error}</p></div><button className="button secondary small" onClick={() => void data.refresh()}>Повторить</button></div>}
      {data.loading ? <div className="workspace-skeleton" aria-label="Загружаем планы" role="status"><div /><div /><div /><div /><span className="sr-only">Загружаем планы…</span></div> : <div className="view-enter" key={view}>{view === 'day' ? <TodayView user={user} selected={selected} onSelect={setSelected} tasks={data.tasks} calendar={data.calendar} busyIds={busyIds} onToggle={(t, o) => void toggleTask(t, o)} onEdit={editTask} onDelete={setDeletingTask} onCreate={createTask} onCreateEvent={() => createEvent()} onEvent={setEventDetails} onCalendar={() => setView('calendar')} refresh={data.refresh} notify={notify} /> : view === 'calendar' ? <CalendarView selected={selected} onSelect={setSelected} timezone={user.timezone} calendar={data.calendar} tasks={data.tasks} onEvent={setEventDetails} onTask={(task, occurrence) => setTaskDetails({ task, occurrence })} onCreate={createEvent} /> : <ListsView lists={data.lists} pro={pro} refresh={data.refresh} notify={notify} onUpgrade={() => setSettings('plan')} />}</div>}
      <footer className="workspace-footer"><span>Маленькие шаги. Ваша большая жизнь.</span><span>lifehub.</span></footer>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">{([{ key: 'day', label: 'Мой день', icon: Sun }, { key: 'calendar', label: 'Календарь', icon: CalendarDays }, { key: 'lists', label: 'Списки', icon: ListChecks }] as const).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)} aria-current={view === key ? 'page' : undefined}><Icon size={20} /><span>{label}</span></button>)}<button onClick={() => setSettings('profile')}><Settings2 size={20} /><span>Профиль</span></button></nav>
    </div>
    {editor && <EntityEditor key={`${editor.kind}:${editor.item?.id || editor.day}:${editor.time || ''}`} kind={editor.kind} item={editor.item} day={editor.day} initialTime={editor.time} timezone={user.timezone} pro={pro} onClose={() => setEditor(null)} onSaved={afterSaved} onUpgrade={() => setSettings('plan')} />}
    {eventDetails && <EventDetails event={eventDetails} timezone={user.timezone} onClose={() => setEventDetails(null)} onEdit={event => { setEventDetails(null); setEditor({ kind: 'event', item: event, day: selected }); }} onDeleted={() => { void data.refresh(); notify('Событие удалено'); }} />}
    {taskDetails && <TaskDetails task={taskDetails.task} occurrence={taskDetails.occurrence} timezone={user.timezone} busy={busyIds.includes(taskDetails.task.id)} onClose={() => setTaskDetails(null)} onToggle={() => void toggleTask(taskDetails.task, taskDetails.occurrence)} onEdit={() => { setTaskDetails(null); editTask(taskDetails.task); }} />}
    {deletingTask && <ConfirmDialog title={deletingTask.recurrence ? 'Удалить повторяющуюся задачу?' : 'Удалить задачу?'} description={`«${deletingTask.title}» ${deletingTask.recurrence ? 'и все её повторения будут удалены' : 'будет удалена'}. Это действие нельзя отменить.`} onClose={() => setDeletingTask(null)} onConfirm={async () => { await api(`/planning/tasks/${deletingTask.id}?version=${deletingTask.version}`, { method: 'DELETE' }); await data.refresh(); notify('Задача удалена'); }} />}
    {settings && <Settings initialTab={settings} user={user} onUserChange={onUserChange} onClose={() => { setSettings(null); void data.refresh(); }} onLogout={onLogout} notify={notify} />}
    {search && <SearchDialog tasks={data.tasks} timezone={user.timezone} onClose={() => setSearch(false)} onTask={task => { setSearch(false); editTask(task); }} onEvent={event => { setSearch(false); setEventDetails(event); }} />}
    {help && <Modal title="Ваше спокойное пространство" onClose={() => setHelp(false)} className="help-modal"><div className="modal-body"><p>Life Hub помогает держать задачи, встречи и списки в одном месте.</p><div className="help-feature"><CheckCircle2 size={20} /><div><strong>Задачи</strong><p>Создайте задачу, добавьте дату и отмечайте маленькие победы.</p></div></div><div className="help-feature"><CalendarDays size={20} /><div><strong>Календарь</strong><p>Переключайте день и неделю. Нажмите на свободное время для новой встречи.</p></div></div><div className="help-feature"><ListChecks size={20} /><div><strong>Списки</strong><p>Добавляйте пункты по одному или сразу несколько с новой строки.</p></div></div><div className="keyboard-hints"><span><kbd>Ctrl / ⌘</kbd> + <kbd>K</kbd> Поиск</span><span><kbd>N</kbd> Новая задача</span><span><kbd>Esc</kbd> Закрыть окно</span></div></div><footer className="modal-footer"><button className="button primary" onClick={() => setHelp(false)}>Всё понятно<Check size={15} /></button></footer></Modal>}
  </div>;
}

function SearchDialog({ tasks, timezone, onClose, onTask, onEvent }: { tasks: Task[]; timezone: string; onClose: () => void; onTask: (task: Task) => void; onEvent: (event: CalendarEvent) => void }) {
  const [query, setQuery] = useState(''), [events, setEvents] = useState<CalendarEvent[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); allPages<CalendarEvent>('/planning/events', controller.signal).then(setEvents).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  const matches = (value: { title: string; notes: string | null }) => query.trim() && `${value.title} ${value.notes || ''}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));
  const foundTasks = tasks.filter(matches), foundEvents = events.filter(matches);
  return <Modal title="Найти в планах" onClose={onClose} className="search-modal"><div className="modal-body"><label className="search-input"><Search size={20} /><input autoFocus aria-label="Поиск по задачам и событиям" placeholder="Название или заметка…" value={query} onChange={e => setQuery(e.target.value)} /><kbd>esc</kbd></label>{loading && <span className="search-loading"><LoaderCircle size={14} className="spinner" />Загружаем события…</span>}{error && <p className="field-error">{error}</p>}<div className="search-results">{foundTasks.length > 0 && <span className="eyebrow">ЗАДАЧИ</span>}{foundTasks.map(task => <button key={task.id} onClick={() => onTask(task)}><CheckCircle2 size={18} /><span><strong>{task.title}</strong><small>{task.completed ? 'Выполнено' : 'В планах'}</small></span><ArrowRight size={15} /></button>)}{foundEvents.length > 0 && <span className="eyebrow">СОБЫТИЯ</span>}{foundEvents.map(event => <button key={event.id} onClick={() => onEvent(event)}><CalendarDays size={18} /><span><strong>{event.title}</strong><small>{dayLabel(dateKey(event.start_at, timezone))}</small></span><ArrowRight size={15} /></button>)}{query.trim() && !foundTasks.length && !foundEvents.length && !loading && <EmptyState title="Пока ничего не нашлось" text="Попробуйте другое слово или часть названия." icon={<Search size={25} />} />}{!query.trim() && <div className="search-placeholder">Найдите нужную задачу или событие по названию и заметкам.</div>}</div></div></Modal>;
}

function CalendarCallback({ onComplete, notify }: { onComplete: () => void; notify: Notify }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), started = useRef(false);
  useEffect(() => { if (started.current) return; started.current = true;
    const run = async () => {
      try {
        const params = new URLSearchParams(window.location.search), raw = sessionStorage.getItem('lifehub.calendar.oauth.v1'), saved = raw ? JSON.parse(raw) : null;
        window.history.replaceState({}, '', '/calendar/callback');
        if (params.has('error')) throw new Error('Доступ к календарю не был предоставлен. Подключение можно повторить в настройках.');
        if (!saved || saved.provider !== 'google' || params.get('state') !== saved.state || !params.get('code')) throw new Error('Ссылка подключения устарела. Начните подключение заново в настройках календаря.');
        await api('/planning/calendar-connections/google/callback', { method: 'POST', body: { code: params.get('code'), state: params.get('state') } });
        sessionStorage.removeItem('lifehub.calendar.oauth.v1'); window.history.replaceState({}, '', '/calendar/callback'); notify('Google Calendar подключён'); onComplete();
      } catch (e) { window.history.replaceState({}, '', '/calendar/callback'); sessionStorage.removeItem('lifehub.calendar.oauth.v1'); setError(errorMessage(e)); setBusy(false); }
    }; void run();
  }, [notify, onComplete]);
  return <main className="callback-page"><Logo /><section className="panel">{busy ? <><LoaderCircle className="spinner" size={34} /><h1>Подключаем календарь</h1><p>Ещё немного — и все события будут рядом.</p></> : <><CircleAlert size={32} /><h1>Подключение не завершено</h1><p role="alert">{error}</p><button className="button primary" onClick={onComplete}>Вернуться в календарь<ArrowRight size={16} /></button></>}</section></main>;
}
