import {MiniCalendar} from './components/MiniCalendar';
import {WorkoutSession} from './product/WorkoutSession';
import {FreeTime} from './components/FreeTime';
import {QuickAdd} from './components/QuickAdd';
import {WorkspaceBar} from './components/WorkspaceBar';
import {NativeHealthSync} from './components/NativeHealthSync';
import {Navigation} from './components/Navigation';
import {AssistantChat} from './components/AssistantChat';
import {Avatar} from './components/Avatar';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Crown, Heart, HelpCircle, LayoutGrid, Link2, ListChecks, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Search, Settings2, Sparkles, Sun, Target, Wallet, X } from 'lucide-react';
import { api, clearSession, errorMessage, getSession, isDemo, setSession, startDemo, subscribeSession } from './lib/api';
import { dateKey, dayLabel, monthDays, shiftDay, todayKey, zonedISO } from './lib/dates';
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

type View = 'day' | 'calendar' | 'free' | 'lists';
interface Toast { id: number; message: string; kind: 'success' | 'error' | 'info' }
const viewPaths = { day: '/planning', calendar: '/planning/calendar', free: '/planning/free-time', lists: '/planning/lists' };
const viewFromPath = (path: string): View => path === viewPaths.calendar ? 'calendar' : path === viewPaths.free ? 'free' : path === viewPaths.lists ? 'lists' : 'day';

export default function App() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [location, setLocation] = useState(window.location.pathname + window.location.search);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [path, search = ''] = location.split('?');
  const query = new URLSearchParams(search);
  const routePositions = useRef(new Map<string,number>());
  const currentLocation = useRef(location);
  const restorePosition = useRef(false);
  const toastId = useRef(0), timers = useRef<number[]>([]);
  const notify: Notify = useCallback((message, kind = 'success') => { const id = ++toastId.current; setToasts(old => [...old.slice(-2), { id, message, kind }]); timers.current.push(window.setTimeout(() => setToasts(old => old.filter(t => t.id !== id)), kind === 'error' ? 8000 : 4500)); }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const navigate = useCallback((value: string, replace = false) => {
    if (value === currentLocation.current) return;
    routePositions.current.set(currentLocation.current, window.scrollY);
    restorePosition.current = false;
    if (replace) window.history.replaceState({}, '', value);
    else window.history.pushState({}, '', value);
    currentLocation.current = value;
    setLocation(value);
  }, []);
  useEffect(() => {
    const pop = () => {
      routePositions.current.set(currentLocation.current, window.scrollY);
      restorePosition.current = true;
      currentLocation.current = window.location.pathname + window.location.search;
      setLocation(currentLocation.current);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    window.scrollTo({top:restorePosition.current ? routePositions.current.get(location) ?? 0 : 0, behavior:'instant'});
  }, [location]);
  const updateUser = useCallback((user: User) => { const current = getSession(); if (current) setSession({ ...current, user }); }, []);
  useEffect(() => {
    if (!session) return; const controller = new AbortController();
    api<User>('/users/me', { signal: controller.signal }).then(user => { if (!controller.signal.aborted) updateUser(user); }).catch(error => { if (!controller.signal.aborted && getSession()) notify(errorMessage(error), 'error'); });
    return () => controller.abort();
  }, [session?.user.id, notify, updateUser]);
  const onAuthenticated = (value: AuthSession) => {
    setSession(value);
    if (path === '/') navigate('/home', true);
  };
  const logout = useCallback(async () => {
    const current = getSession();
    try { if (current && !current.demo) await disablePush().catch(() => {}); if (current && !current.demo) await api('/auth/logout', { method: 'POST', body: { refresh_token: current.tokens.refresh_token } }); }
    catch { notify('Вход на этом устройстве закрыт. Сервер не ответил на запрос завершения сессии.', 'info'); }
    finally { clearSession(); navigate('/', true); }
  }, [navigate, notify]);
  const user = session?.user;
  const planning = path in {'/planning':1,'/planning/calendar':1,'/planning/free-time':1,'/planning/lists':1};
  const module = path.startsWith('/modules/') ? path.split('/')[2]
    : planning ? 'planning' : path === '/' || path === '/home' ? 'dashboard' : 'missing';
  const onboarded = user?.onboarding_completed;
  return <>
    {!user ? <AuthScreen onAuthenticated={onAuthenticated} onDemo={() => { startDemo(); navigate('/planning', true); }}/>
      : !onboarded ? <Onboarding user={user} onComplete={updated => { updateUser(updated); if (path === '/') navigate('/home', true); }} onLogout={() => void logout()}/>
      : path === '/calendar/callback' ? <CalendarCallback onComplete={() => navigate('/planning/calendar', true)} notify={notify}/>
      : planning && (isPro(user) || user.free_modules.includes('planning'))
        ? <Workspace navigateProduct={navigate} user={user} view={viewFromPath(path)} search={search} onUserChange={updateUser} onLogout={logout} notify={notify}/>
        : <Product user={user} module={module} path={path} search={query.toString()} navigate={navigate} onUserChange={updateUser} onLogout={logout} notify={notify}/>}
    {user && onboarded && <NativeHealthSync key={user.id} user={user}/>}
    {user && onboarded && path !== '/calendar/callback' && <>
      <AssistantChat key={user.id} user={user} path={path} navigate={navigate}/>
      <QuickAdd key={user.id+':add'} user={user} notify={notify}/>{!isDemo()&&(isPro(user)||user.free_modules.includes('health'))&&<WorkoutSession key={user.id+':workout'} user={user} notify={notify}/>}
    </>}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">{toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.kind === 'error' ? <CircleAlert size={18} /> : toast.kind === 'success' ? <CheckCircle2 size={18} /> : <Bell size={18} />}<span>{toast.message}</span><button className="icon-button small" aria-label="Закрыть уведомление" onClick={() => setToasts(old => old.filter(t => t.id !== toast.id))}><X size={15} /></button></div>)}</div>
  </>;
}

function Workspace({ navigateProduct, user, view, search, onUserChange, onLogout, notify }: { navigateProduct: (path: string) => void; user: User; view: View; search:string; onUserChange: (user: User) => void; onLogout: () => void; notify: Notify }) {
  const params = new URLSearchParams(search);
  const day = params.get('day');
  const validDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0,10)===day;
  const [selected, setSelected] = useState(validDay ? day : todayKey(user.timezone));
  useEffect(() => {if (validDay) setSelected(day);}, [day,validDay]);
  const [editor, setEditor] = useState<{ kind: 'task' | 'event'; item?: Task | CalendarEvent; day: string; time?: string; endTime?: string } | null>(null);
  const [settings, setSettings] = useState<'profile' | 'connections' | 'plan' | null>(null), [searchOpen, setSearchOpen] = useState(() => params.get('find') === '1'), [help, setHelp] = useState(false), [createMenu, setCreateMenu] = useState(false);
  const [eventDetails, setEventDetails] = useState<CalendarEvent | null>(null), [taskDetails, setTaskDetails] = useState<{ task: Task; occurrence?: TaskOccurrence } | null>(null), [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [calendarMove,setCalendarMove]=useState<{event:CalendarEvent;day:string;time:string}|null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]), lock = useRef(new Set<string>()), menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { window.dispatchEvent(new CustomEvent('lifehub:chat-day', {detail: selected})); }, [selected]);
  useEffect(() => {
    const showPlan = () => setSettings('plan');
    window.addEventListener('lifehub:show-plan',showPlan);
    return () => window.removeEventListener('lifehub:show-plan',showPlan);
  }, []);
  const month = monthDays(selected), rangeStart=view==='free'?todayKey(user.timezone):month[0];
  const rangeEnd=view==='free'?shiftDay(rangeStart,14):shiftDay(month.at(-1)!,1);
  const data = usePlanning(user.timezone,rangeStart,rangeEnd);
  useEffect(() => {if(new URLSearchParams(search).get('find')==='1')setSearchOpen(true);},[search]);
  const [focusMode,setFocusMode]=useState(false);
  const [hiddenSources,setHiddenSources]=useState<string[]>([]);
  const calendar=data.calendar?{...data.calendar,events:data.calendar.events.filter(event=>!hiddenSources.includes(event.source==='ai'?'local':event.source))}:null;
  const seenLink = useRef('');
  useEffect(() => {
    if (!search) {seenLink.current='';return;}
    if (data.loading || seenLink.current===search) return;
    const params = new URLSearchParams(search);
    const task = data.tasks.find(item => item.id===params.get('task'));
    const event = data.calendar?.events.find(item => item.id===params.get('event')
      && (!params.has('occurrence') || item.occurrence_at===params.get('occurrence')));
    if (task) {
      const occurrence=data.calendar?.tasks.find(item => item.task_id===task.id &&
        (params.has('occurrence') ? item.occurrence_at===params.get('occurrence') : item.occurrence_at===null));
      setTaskDetails({task,occurrence});
      seenLink.current=search;
    } else if (event) {
      setEventDetails(event);
      seenLink.current=search;
    } else {
      const id=params.get('event');
      if (!id||params.has('occurrence'))return;
      const controller=new AbortController();
      api<CalendarEvent>('/planning/events/'+encodeURIComponent(id),{signal:controller.signal}).then(result=>{
        if(!controller.signal.aborted){setEventDetails(result);seenLink.current=search;}
      }).catch(error=>{if(!controller.signal.aborted)notify(errorMessage(error),'error');});
      return ()=>controller.abort();
    }
  }, [search,data.loading,data.tasks,data.calendar,notify]);
  const pro = user.plan === 'pro' || (user.plan === 'trial' && Boolean(user.trial_ends) && Date.parse(user.trial_ends!) > Date.now());
  const title = { day: 'Мой день', calendar: 'Календарь', free: 'Свободное время', lists: 'Списки' }[view];
  const createTask = () => { setEditor({ kind: 'task', day: selected }); setCreateMenu(false); };
  const createEvent = (day = selected, time?: string, endTime?:string) => { setEditor({ kind: 'event', day, time, endTime }); setCreateMenu(false); };
  const editTask = (task: Task) => setEditor({ kind: 'task', item: task, day: selected });
  const navigate = (view: View) => navigateProduct(viewPaths[view]+'?day='+encodeURIComponent(selected));
  useEffect(() => { document.title = `${title} · Life Hub`; }, [title]);
  useEffect(() => { const keydown = (e: KeyboardEvent) => { const input = e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable); if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } else if (e.key === 'Escape') { setCreateMenu(false); } else if (!input && !document.querySelector('dialog[open]') && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor({ kind: 'task', day: selected }); } }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, [selected]);
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
    <Navigation user={user} path={viewPaths[view]} navigate={navigateProduct} onSettings={() => setSettings('profile')} onConnections={() => setSettings('connections')} onSearch={() => setSearchOpen(true)} lists={view==='calendar'?[]:data.lists} context={view==='calendar'&&<div className="life-calendar-context"><MiniCalendar selected={selected} timezone={user.timezone} onSelect={setSelected} marked={calendar?.events.map(event=>dateKey(event.start_at,user.timezone))??[]}/><fieldset><legend>Календари</legend>{([['local','Личное'],['google','Google Calendar'],['apple','Apple Calendar']] as const).map(([source,label])=><label key={source}><input type="checkbox" checked={!hiddenSources.includes(source)} onChange={()=>setHiddenSources(old=>old.includes(source)?old.filter(item=>item!==source):[...old,source])}/>{label}</label>)}</fieldset></div>}/>
    <div className="app-main"><WorkspaceBar user={user} title="Планирование" onHome={() => navigateProduct('/home')}
      onProfile={() => setSettings('profile')} onSearch={() => setSearchOpen(true)}/>
      <main id="main-content" className={`workspace-content view-${view}${focusMode&&view==='day'?' life-focus-mode':''}`}>{view!=='free'&&<header className="page-header planning-header"><div><div className="life-page-eyebrow"><span>Планирование</span>{isDemo() && <span className="demo-badge">Демо</span>}</div><h1>{title}</h1>{view==='day'&&<span className="life-page-subtitle">{dayLabel(selected,{weekday:'long',day:'numeric',month:'long'})}</span>}</div><div className="page-actions">{view==='day'&&<button className="button secondary" aria-pressed={focusMode} onClick={()=>setFocusMode(value=>!value)}><Target size={16}/>{focusMode?'Выйти из фокуса':'Фокус'}</button>}<button className="icon-button refresh-button" onClick={() => void data.refresh()} aria-label="Обновить данные" disabled={data.refreshing || data.loading}><RefreshCw size={17} className={data.refreshing ? 'spinner' : ''} /></button><div className="create-menu-wrap" ref={menuRef}><div className="split-button"><button className="button primary" onClick={view === 'calendar' ? () => createEvent() : createTask}><Plus size={17} />{view === 'calendar' ? 'Новое событие' : 'Новая задача'}</button><button className="split-trigger" aria-label="Другие способы добавления" aria-expanded={createMenu} onClick={() => setCreateMenu(!createMenu)}><ChevronDown size={16} /></button></div>{createMenu && <div className="action-menu create-menu"><button onClick={createTask}><CheckCircle2 size={16} />Создать задачу<kbd>N</kbd></button><button onClick={() => createEvent()}><CalendarDays size={16} />Создать событие</button><button onClick={() => { navigate('lists'); setCreateMenu(false); }}><ListChecks size={16} />Открыть списки</button></div>}</div></div></header>}
      <nav className="product-tabs planning-tabs" aria-label="Разделы планирования">
        {(['day','calendar','free','lists'] as const).map((key,index) => <button key={key} className={view===key?'active':''}
          aria-current={view===key?'page':undefined} onClick={() => navigate(key)}>{['Мой день','Календарь','Свободно','Списки'][index]}</button>)}
        <button onClick={() => setSettings('connections')}>Подключения</button>
        <button onClick={() => setHelp(true)}>Помощь</button>
      </nav>
      {data.error && <div className="workspace-error" role="alert"><CircleAlert size={19} /><div><strong>Не удалось обновить планы</strong><p>{data.error}</p></div><button className="button secondary small" onClick={() => void data.refresh()}>Повторить</button></div>}
      {data.loading ? <div className="workspace-skeleton" aria-label="Загружаем планы" role="status"><div /><div /><div /><div /><span className="sr-only">Загружаем планы…</span></div> : <div className="view-enter" key={view}>{view === 'day' ? <TodayView user={user} selected={selected} onSelect={setSelected} tasks={data.tasks} calendar={data.calendar} busyIds={busyIds} onToggle={(t, o) => void toggleTask(t, o)} onEdit={editTask} onDelete={setDeletingTask} onCreate={createTask} onCreateEvent={() => createEvent()} onEvent={setEventDetails} onCalendar={() => navigate('calendar')} onFree={() => navigate('free')} refresh={data.refresh} notify={notify} /> : view === 'calendar' ? <CalendarView selected={selected} onSelect={setSelected} timezone={user.timezone} calendar={calendar} tasks={data.tasks} onEvent={setEventDetails} onTask={(task, occurrence) => setTaskDetails({ task, occurrence })} onCreate={createEvent} onMove={(event,day,time)=>setCalendarMove({event,day,time})} /> : view === 'free' ? <FreeTime user={user} calendar={data.calendar} tasks={data.tasks} notify={notify} onCreate={createEvent}/> : <ListsView initialList={params.get('list')??undefined} lists={data.lists} pro={pro} refresh={data.refresh} notify={notify} onUpgrade={() => setSettings('plan')} />}</div>}
      </main>
    </div>
    {calendarMove&&<ConfirmDialog title="Перенести событие?" description={calendarMove.event.title+' · '+dayLabel(calendarMove.day)+' в '+calendarMove.time}
      confirmLabel="Перенести" onClose={()=>setCalendarMove(null)} onConfirm={async()=>{
        const {event,day,time}=calendarMove,start=zonedISO(day,time,user.timezone);
        const end=new Date(Date.parse(start)+Date.parse(event.end_at)-Date.parse(event.start_at)).toISOString();
        await api('/planning/events/'+event.id,{method:'PATCH',body:{version:event.version,start_at:start,end_at:end}});
        await data.refresh();notify('Событие перенесено');
      }}/>}
    {editor && <EntityEditor key={`${editor.kind}:${editor.item?.id || editor.day}:${editor.time || ''}`} kind={editor.kind} item={editor.item} day={editor.day} initialTime={editor.time} initialEndTime={editor.endTime} timezone={user.timezone} pro={pro} onClose={() => setEditor(null)} onSaved={afterSaved} onUpgrade={() => setSettings('plan')} />}
    {eventDetails && <EventDetails event={eventDetails} timezone={user.timezone} onClose={() => { setEventDetails(null); if (params.has("event")) navigate(view); }} onEdit={event => { setEventDetails(null); setEditor({ kind: 'event', item: event, day: selected }); }} onDeleted={() => { void data.refresh(); notify('Событие удалено'); }} />}
    {taskDetails && <TaskDetails task={taskDetails.task} occurrence={taskDetails.occurrence} timezone={user.timezone} busy={busyIds.includes(taskDetails.task.id)} onClose={() => { setTaskDetails(null); if (params.has("task")) navigate(view); }} onToggle={() => void toggleTask(taskDetails.task, taskDetails.occurrence)} onEdit={() => { setTaskDetails(null); editTask(taskDetails.task); }} />}
    {deletingTask && <ConfirmDialog title={deletingTask.recurrence ? 'Удалить повторяющуюся задачу?' : 'Удалить задачу?'} description={`«${deletingTask.title}» ${deletingTask.recurrence ? 'и все её повторения будут удалены' : 'будет удалена'}. Это действие нельзя отменить.`} onClose={() => setDeletingTask(null)} onConfirm={async () => { await api(`/planning/tasks/${deletingTask.id}?version=${deletingTask.version}`, { method: 'DELETE' }); await data.refresh(); notify('Задача удалена'); }} />}
    {settings && <Settings initialTab={settings} user={user} onUserChange={onUserChange} onClose={() => { setSettings(null); void data.refresh(); }} onLogout={onLogout} notify={notify} />}
    {searchOpen && <SearchDialog tasks={data.tasks} timezone={user.timezone} onFree={() => {setSearchOpen(false);navigate('free');}} onClose={() => {setSearchOpen(false);if(params.has('find'))navigate(view);}} onTask={task => { setSearchOpen(false); editTask(task); }} onEvent={event => { setSearchOpen(false); setEventDetails(event); }} />}
    {help && <Modal title="Ваше спокойное пространство" onClose={() => setHelp(false)} className="help-modal"><div className="modal-body"><p>Life Hub помогает держать задачи, встречи и списки в одном месте.</p><div className="help-feature"><CheckCircle2 size={20} /><div><strong>Задачи</strong><p>Создайте задачу, добавьте дату и отмечайте маленькие победы.</p></div></div><div className="help-feature"><CalendarDays size={20} /><div><strong>Календарь</strong><p>Переключайте день и неделю. Нажмите на свободное время для новой встречи.</p></div></div><div className="help-feature"><ListChecks size={20} /><div><strong>Списки</strong><p>Добавляйте пункты по одному или сразу несколько с новой строки.</p></div></div><div className="keyboard-hints"><span><kbd>Ctrl / ⌘</kbd> + <kbd>K</kbd> Поиск</span><span><kbd>N</kbd> Новая задача</span><span><kbd>Esc</kbd> Закрыть окно</span></div></div><footer className="modal-footer"><button className="button primary" onClick={() => setHelp(false)}>Всё понятно<Check size={15} /></button></footer></Modal>}
  </div>;
}

function SearchDialog({ tasks, timezone, onClose, onTask, onEvent, onFree }: { tasks: Task[]; timezone: string; onClose: () => void; onTask: (task: Task) => void; onEvent: (event: CalendarEvent) => void; onFree:()=>void }) {
  const [query, setQuery] = useState(''), [events, setEvents] = useState<CalendarEvent[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); allPages<CalendarEvent>('/planning/events', controller.signal).then(setEvents).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  const matches = (value: { title: string; notes: string | null }) => query.trim() && `${value.title} ${value.notes || ''}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));
  const foundTasks = tasks.filter(matches), foundEvents = events.filter(matches);
  return <Modal title="Найти в планах" onClose={onClose} className="search-modal"><div className="modal-body"><label className="search-input"><Search size={20} /><input autoFocus aria-label="Поиск по задачам и событиям" placeholder="Название или заметка…" value={query} onChange={e => setQuery(e.target.value)} /><kbd>esc</kbd></label>{loading && <span className="search-loading"><LoaderCircle size={14} className="spinner" />Загружаем события…</span>}{error && <p className="field-error">{error}</p>}<div className="search-results">{(!query.trim()||/свобод|окна/.test(query.toLowerCase()))&&<button onClick={onFree}><CalendarDays size={18}/><strong>Свободное время</strong><ArrowRight size={15}/></button>}{foundTasks.length > 0 && <span className="eyebrow">ЗАДАЧИ</span>}{foundTasks.map(task => <button key={task.id} onClick={() => onTask(task)}><CheckCircle2 size={18} /><span><strong>{task.title}</strong><small>{task.completed ? 'Выполнено' : 'В планах'}</small></span><ArrowRight size={15} /></button>)}{foundEvents.length > 0 && <span className="eyebrow">СОБЫТИЯ</span>}{foundEvents.map(event => <button key={event.id} onClick={() => onEvent(event)}><CalendarDays size={18} /><span><strong>{event.title}</strong><small>{dayLabel(dateKey(event.start_at, timezone))}</small></span><ArrowRight size={15} /></button>)}{query.trim() && !foundTasks.length && !foundEvents.length && !loading && <EmptyState title="Пока ничего не нашлось" text="Попробуйте другое слово или часть названия." icon={<Search size={25} />} />}{!query.trim() && <div className="search-placeholder">Найдите нужную задачу или событие по названию и заметкам.</div>}</div></div></Modal>;
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
