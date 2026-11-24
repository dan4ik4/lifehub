import { t, locale } from '../lib/language';
import {BookCover,DiaryComposer,ReadingPanel} from './ReadingJournal';
import {BudgetOverview} from './BudgetOverview';
import {openWorkout,useActiveWorkout} from './WorkoutSession';
import {openAssistant,openQuickAdd,refreshWorkspace} from '../lib/workspace';
import {WorkspaceBar} from '../components/WorkspaceBar';
import {CrossInsights} from './CrossInsights';
import {HealthOverview, WorkoutActivity} from './HealthOverview';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {CsvImportDialog} from '../components/CsvImport';
import {GoalsHabits} from './GoalsHabits';
import {HealthConnection} from './HealthConnection';
import {Navigation} from '../components/Navigation';
import {Dashboard} from './Dashboard';
import {DiaryReview} from './DiaryReview';
import {formatAmount} from "./format";
import { Avatar } from "../components/Avatar";
import exerciseNames from "./exercises.json";
import { displayWeight, storeWeight, weightLabel } from "./weight";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Crown,
  Heart,
  LayoutGrid,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { api, errorMessage, isDemo } from "../lib/api";
import { dayLabel, shiftMonth, todayKey } from "../lib/dates";
import type { User, Notify } from "../lib/types";
import { Modal, ConfirmDialog, EmptyState, Logo } from "../components/ui";
import { Settings } from "../components/Settings";
import { sections, bodyFor } from "./schema";
import type { Row, Field, Section } from "./schema";
import { FinanceOverview, RecordDetail } from "./details";
import "./product.css";
import {
  HealthChart,
  BookStats,
  SmartGuide,
  WeightTarget,
  NutritionBalance,
  DiaryCalendar,
} from "./Extras";
const names: Record<string, string> = {
  dashboard: t("Главная"),
  planning: t("Планирование"),
  goals_habits: t("Цели и привычки"),
  health: t("Здоровье"),
  finance: t("Финансы"),
  books: t("Книги и дневник"),
};
export const isPro = (user: User) =>
  user.plan === "pro" ||
  (user.plan === "trial" &&
    !!user.trial_ends &&
    Date.parse(user.trial_ends) > Date.now());
export const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
export const amount = formatAmount;
export const dateLabel = (value: unknown) =>
  value
    ? new Date(
        text(value).length === 10 ? text(value) + "T12:00:00" : text(value),
      ).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
export function Product({
  user,
  module,
  path,
  search,
  navigate,
  onUserChange,
  onLogout,
  notify,
}: {
  user: User;
  module: string;
  path: string;
  search: string;
  navigate: (path: string) => void;
  onUserChange: (u: User) => void;
  onLogout: () => void;
  notify: Notify;
}) {
  const [settings, setSettings] = useState<"profile" | "plan" | "connections" | null>(null);
  const pro = isPro(user);
  const allowed = pro || user.free_modules.includes(module);
  const [, , , tab, recordId] = path.split('/');
  const modulePath = '/modules/'+module;
  const healthOverview = module === 'health' && (!tab || tab === 'overview');
  const financeHome=module==='finance'&&(!tab||tab==='overview');
  const financeOverview = module === 'finance' && tab === 'analysis';
  const section = sections[module]?.find(item => item.key === tab) ?? sections[module]?.[0];
  const tabs = [
    ...(module === 'health' || module === 'finance' ? [{key:'overview',label:t("Обзор"),pro:false}] : []),
    ...(sections[module] ?? []),
    ...(module === 'finance' ? [{key:'analysis',label:t("Аналитика"),pro:true}] : []),
  ];
  const activeTab = (healthOverview||financeHome) ? 'overview' : financeOverview ? 'analysis' : section?.key;
  const title = names[module] ?? (module === 'insights' ? t("Что видно вместе") : t("Страница недоступна"));
  useEffect(() => { document.title = title+' · LifeHub'; }, [title]);
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      if(document.querySelector('dialog[open]'))return;
      const canPlan=pro||user.free_modules.includes('planning');
      const key=event.key.toLowerCase();
      if((event.metaKey||event.ctrlKey)&&key==='k'&&canPlan){event.preventDefault();navigate('/planning?find=1');}
      if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&key==='n'&&event.target instanceof HTMLElement&&
        !event.target.isContentEditable&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){
        event.preventDefault();openQuickAdd();
      }
    };
    window.addEventListener('keydown',keydown);
    return ()=>window.removeEventListener('keydown',keydown);
  },[navigate,pro,user.free_modules]);
  useEffect(() => {
    const showPlan = () => setSettings('plan');
    window.addEventListener('lifehub:show-plan',showPlan);
    return () => window.removeEventListener('lifehub:show-plan',showPlan);
  }, []);
  return (
    <div className="app-layout">
      <Navigation user={user} path={path} navigate={navigate} onSettings={() => setSettings('profile')}/>
      <div className="app-main product-layout">
        <a className="skip-link" href="#product-main">{t("Перейти к содержимому")}</a>
        <WorkspaceBar user={user} title={module==='dashboard'?t("Сегодня"):title}
          onHome={() => navigate('/home')} onProfile={() => setSettings('profile')}/>
        <main data-module={module} data-tab={activeTab} id="product-main" className={'product-main'+(module==='dashboard'?' hub-main-home':'')}>
          {module!=='dashboard' && (!section||!allowed||healthOverview||financeOverview||module==='goals_habits') && <header className="product-title"><div>
            <span className="life-page-eyebrow">{title}</span>
            <h1>{healthOverview?t("Обзор"):financeOverview?t("Аналитика"):module==='goals_habits'?(tab==='goals'?t("Цели"):tab==='habits'?t("Привычки"):t("Сегодня")):module==='insights'?t("Связи между модулями"):title}</h1>
            {healthOverview&&<p className="life-page-subtitle">{t("Сон, вес и движение за неделю")}</p>}
            {module==='insights'&&<p className="life-page-subtitle">{t("Наблюдения по вашим записям")}</p>}
          </div>{healthOverview&&<button className="button primary" onClick={()=>openQuickAdd()}><Plus size={16}/>{t("Записать")}</button>}</header>}
          {isDemo() ? <EmptyState title={t("Откройте свой аккаунт")} text={t("Войдите, чтобы сохранять записи в модулях.")} action={t("Перейти ко входу")} onAction={onLogout}/>
            : module === 'dashboard' ? <Dashboard key={user.id} user={user} navigate={navigate} notify={notify} onProfile={()=>setSettings('profile')}/>
            : module === 'insights' ? <CrossInsights user={user} pro={pro} navigate={navigate} view={tab}/>
            : !names[module] || (tab && !tabs.some(item => item.key === tab) && module !== 'goals_habits') ?
              <EmptyState title={t("Такой страницы нет")} text={t("Вернитесь на главную или выберите модуль в меню.")} action={t("На главную")} onAction={() => navigate('/home')}/>
            : !allowed ? <Locked onPlan={() => setSettings('plan')} module/>
            : module === 'goals_habits' ? <>
              <nav className="product-tabs" aria-label={t("Разделы целей и привычек")}>{[['',t("Сегодня")],['habits',t("Привычки")],['goals',t("Цели")],['stats',t("Статистика")]].map(([key,label])=><button key={key} className={(tab??'')===key?'active':''} onClick={()=>navigate(modulePath+(key?'/'+key:''))}>{label}</button>)}</nav>
              <GoalsHabits user={user} notify={notify} view={tab} create={new URLSearchParams(search).get('new')}/>
            </>
            : <>
              <nav className="product-tabs" aria-label={t("Подразделы")}>
                {tabs.map(item => <button key={item.key} aria-current={item.key===activeTab?'page':undefined}
                  className={item.key===activeTab?'active':''} onClick={() => navigate(modulePath+'/'+item.key+(module==='finance'&&search?'?'+search:''))}>
                  {item.label}{item.pro&&!pro&&<Crown size={13}/>}
                </button>)}
              </nav>
              {healthOverview ? <HealthOverview user={user} navigate={navigate}/>
                : financeOverview ? pro ? <FinanceOverview user={user} revision={search} analysis
                    preferences={new URLSearchParams(search)} onSelect={params => navigate(modulePath+'/analysis?'+params)}
                    onCategory={params => navigate(modulePath+'/transactions?'+params)}/> : <Locked onPlan={() => setSettings('plan')}/>
                : section && (section.pro&&!pro ? <Locked onPlan={() => setSettings('plan')}/> :
                  <Records key={section.path} section={section} user={user} notify={notify} route={modulePath+'/'+section.key}
                    search={search} navigate={navigate} recordId={recordId} financeHome={financeHome}/>)}
            </>}
        </main>
      </div>
      {settings && (
        <Settings
          user={user}
          initialTab={settings}
          onClose={() => setSettings(null)}
          onUserChange={onUserChange}
          onLogout={onLogout}
          notify={notify}
        />
      )}
    </div>
  );
}
function Locked({
  onPlan,
  module = false,
}: {
  onPlan: () => void;
  module?: boolean;
}) {
  return (
    <EmptyState
      icon={<Crown size={28} />}
      title={
        module
          ? t("Этот модуль не входит в ваш выбор Free")
          : t("Возможность Life Hub Pro")
      }
      text={
        module
          ? t("Остальные выбранные вами модули доступны в меню.")
          : t("Сохраняйте больше деталей и смотрите полную историю.")
      }
      action={t("Посмотреть возможности")}
      onAction={onPlan}
    />
  );
}
function useRows(path: string) {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  const load = useCallback(
    async (offset = 0) => {
      const seq = ++sequence.current;
      setBusy(true);
      setError("");
      try {
        const result = await api<{ items: Row[]; has_more: boolean }>(
          path + (path.includes("?") ? "&" : "?") + `limit=50&offset=${offset}`,
        );
        if (mounted.current && seq === sequence.current) {
          setRows((old) => (offset ? [...old, ...result.items] : result.items));
          setMore(result.has_more);
        }
      } catch (e) {
        if (mounted.current && seq === sequence.current)
          setError(errorMessage(e));
      } finally {
        if (mounted.current && seq === sequence.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [path],
  );
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    window.addEventListener("lifehub:data-changed", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("lifehub:data-changed", focus);
    };
  }, [load]);
  return { rows, loading, error, more, busy, load };
}
function Records({
  section: s,
  user,
  notify,
  route,
  search,
  navigate,
  recordId, financeHome=false,
}: {
  section: Section;
  user: User;
  notify: Notify;
  route: string;
  search: string;
  navigate: (path:string)=>void;
  recordId?: string; financeHome?:boolean;
}) {
  const [editor, setEditor] = useState<Record<string, unknown> | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [query, setQuery] = useState(""),
    [searched, setSearched] = useState(""),
    [catalog, setCatalog] = useState(false),
    [busyId, setBusyId] = useState(""),
    [smart, setSmart] = useState(false),
    [filterDay, setFilterDay] = useState(""),
    [bookStatus, setBookStatus] = useState(s.key==="books"?"want":"");
  const activeWorkout=useActiveWorkout(user.id);
  const params = new URLSearchParams(search);
  const currency = /^[A-Z]{3}$/.test(params.get('currency')??'') ? params.get('currency')! : 'PLN';
  const month = /^[1-8]\d{3}-(0[1-9]|1[0-2])$/.test(params.get('month')??'') ? params.get('month')! : todayKey(user.timezone).slice(0,7);
  const financeFilter = new URLSearchParams({month,currency});
  if (params.get('category')) financeFilter.set('category',params.get('category')!);
  if (params.get('kind')) financeFilter.set('kind',params.get('kind')!);
  if (s.key==='transactions'&&params.get('q')) financeFilter.set('q',params.get('q')!);
  const [importOpen,setImportOpen] = useState(false);
  const [linkError,setLinkError] = useState('');
  const {preferences} = useAssistantPreferences(user.id);
  const pro = isPro(user);
  const hasPlanning = pro || user.free_modules.includes('planning');
  const canImport = hasPlanning && preferences.messages && preferences.modules;
  const saveFilter = (next:URLSearchParams) => navigate(route+(next.size?'?'+next:''));
  const showDetail = (row:Row) => navigate(route+'/'+row.id+(search?'?'+search:''));
  const closeDetail = () => {
    setDetail(null);
    navigate(route+(search?'?'+search:''));
  };
  useEffect(() => {
    setLinkError('');
    setDetail(null);
    if (!recordId) return;
    const controller = new AbortController();
    api<Row>(s.path+'/'+encodeURIComponent(recordId),{signal:controller.signal}).then(row => {
      if (!controller.signal.aborted) setDetail(row);
    }).catch(cause => {
      if (!controller.signal.aborted) setLinkError(errorMessage(cause));
    });
    return () => controller.abort();
  }, [recordId,s.path]);
  const base =
    s.key === "diary" && searched
      ? s.path + "/search?q=" + encodeURIComponent(searched)
      : s.key === "transactions" ? "/finance/transaction-history?"+financeFilter : s.path;
  const filter = filterDay
    ? "day=" + filterDay
    : bookStatus
      ? "status=" + bookStatus
      : "";
  const data = useRows(
      base + (filter ? (base.includes("?") ? "&" : "?") + filter : ""),
    ),
    day = todayKey(user.timezone);
  async function toggle(h: Row) {
    if (busyId) return;
    setBusyId(h.id);
    try {
      await api(`/habits/${h.id}/checkins`, {
        method: "POST",
        body: {
          version: h.version,
          day,
          value: h.today_complete ? 0 : h.target,
        },
      });
      await data.load();
    } catch (e) {
      notify(errorMessage(e), "error");
      await data.load();
    } finally {
      setBusyId("");
    }
  }
  return (
    <section className={'product-section life-section-'+s.key}>
      <div className="section-toolbar life-record-heading">
        <div><span className="life-page-eyebrow">{route.includes('/health/')?t("Здоровье"):route.includes('/finance/')?t("Финансы"):t("Книги и дневник")}</span>
          {financeHome?<div className="life-finance-month">
            <button className="icon-button" aria-label={t("Предыдущий месяц")} onClick={()=>navigate('/modules/finance?'+new URLSearchParams({month:shiftMonth(month+'-01',-1).slice(0,7),currency}))}>‹</button>
            <h1>{dayLabel(month+'-01',{month:'long',year:'numeric'}).replace(' г.','')}</h1>
            <button className="icon-button" aria-label={t("Следующий месяц")} onClick={()=>navigate('/modules/finance?'+new URLSearchParams({month:shiftMonth(month+'-01',1).slice(0,7),currency}))}>›</button>
          </div>:<h1>{s.label}</h1>}
        </div>
        <div className="product-actions">
          <button
            className="icon-button"
            disabled={data.busy}
            aria-label={t("Обновить")}
            onClick={() => void data.load()}
          >
            <RefreshCw size={18} className={data.busy ? "spinner" : ""} />
          </button>
          {s.key === "books" && (
            <button
              className="button secondary"
              onClick={() => setCatalog(true)}
            >
              <Search size={16} />
              {t("Найти книгу")}
            </button>
          )}
          {s.key === "goals" && (
            <button className="button secondary" onClick={() => setSmart(true)}>
              {t("Помочь сформулировать")}
            </button>
          )}
          {s.key==='transactions' && <button className="button secondary" onClick={() => setImportOpen(true)}>{t("Импорт выписки")}</button>}
          <button className="button primary" onClick={() => setEditor(s.key==='transactions'?{currency}:s.key==='budgets'?{month,currency}:s.key==='diary'&&filterDay?{day:filterDay}:{})}>
            <Plus size={17}/>{({workouts:t("Записать вручную"),sleep:t("Записать сон"),weight:t("Записать вес"),diary:t("Написать"),transactions:t("Добавить операцию"),books:t("Добавить книгу"),nutrition:t("Добавить приём пищи")} as Record<string,string>)[s.key]??t("Добавить")}
          </button>
          {s.key==='workouts'&&<button className="button primary life-brown-button" onClick={()=>openWorkout()}>{activeWorkout?t("Продолжить тренировку"):t("Начать тренировку")}</button>}
        </div>
      </div>
      {["sleep", "weight"].includes(s.key) && (
        <HealthChart section={s.key} user={user} revision={data.rows} />
      )}
      {s.key==='workouts' && <WorkoutActivity user={user} revision={data.rows} onSelect={showDetail}/>}
      {s.key==='budgets'&&<BudgetOverview month={month} currency={currency} revision={data.rows} notify={notify} navigate={navigate} onRefresh={()=>void data.load()}/>}
      {s.key === "weight" && pro && (
        <WeightTarget
          unit={user.weight_unit}
          onChanged={() => void data.load()}
        />
      )}
      {s.key === "nutrition" && (
        <NutritionBalance user={user} revision={data.rows} />
      )}
      {s.key==="books"&&<ReadingPanel user={user} rows={data.rows} pro={pro} notify={notify} onOpen={showDetail} onEdit={setEditor} onSaved={()=>void data.load()}/>}
      {s.key === "books" && pro && <details className="hub-disclosure"><summary>{t("Статистика чтения")}</summary><BookStats revision={data.rows}/></details>}
      {s.key==="books"&&<div className="life-shelf-head"><h2>{bookStatus==='reading'?t("Читаю"):bookStatus==='read'?t("Прочитано"):t("Хочу прочитать")}</h2>
        <div className="segmented" aria-label={t("Полки")}>{[['want',t("Хочу")],['reading',t("Читаю")],['read',t("Прочитано")]].map(([key,label])=><button key={key} type="button" aria-pressed={bookStatus===key} className={bookStatus===key?'selected':''} onClick={()=>setBookStatus(key)}>{label}</button>)}</div></div>}
      {s.key==="diary"&&<DiaryComposer user={user} day={filterDay||day} notify={notify} onSaved={()=>void data.load()}/>}
      {s.key==="diary"&&<aside className="life-diary-aside">
        <DiaryCalendar selected={filterDay} onSelect={setFilterDay} user={user} revision={data.rows}/>
        <details className="hub-disclosure life-diary-review"><summary>{t("Недельный обзор с ИИ")}</summary><DiaryReview user={user} pro={pro} revision={data.rows} onSource={setFilterDay}/></details>
        {filterDay&&<button className="button secondary" onClick={()=>setFilterDay('')}>{t("Показать все дни")}</button>}
      </aside>}
      {s.key==='transactions' && <>
        <FinanceOverview user={user} revision={data.rows} preferences={financeFilter} home={financeHome} goto={navigate} onSelect={financeHome?p=>navigate('/modules/finance?'+p):saveFilter}
          onCategory={saveFilter}/>
        <div className="hub-filter-row" aria-label={t("Фильтры операций")}>
          <form onSubmit={event=>{event.preventDefault();const next=new URLSearchParams(financeFilter);if(query.trim())next.set('q',query.trim());else next.delete('q');saveFilter(next);}}>
            <input aria-label={t("Поиск операций")} value={query} onChange={event=>setQuery(event.target.value)} maxLength={120} placeholder={t("Название или категория")}/>
            <button className="button secondary" type="submit"><Search size={15}/>{t("Найти")}</button>
          </form>
          <label>{t("Тип")}<select value={params.get('kind')??''} onChange={event => {
            const next = new URLSearchParams(financeFilter);
            if (event.target.value) next.set('kind',event.target.value); else next.delete('kind');
            saveFilter(next);
          }}><option value="">{t("Все операции")}</option><option value="expense">{t("Расходы")}</option><option value="income">{t("Доходы")}</option></select></label>
          {params.get('category') && <button className="button secondary" onClick={() => {
            const next = new URLSearchParams(financeFilter);
            next.delete('category');
            saveFilter(next);
          }}>{t("Снять фильтр «")}{params.get('category')}»</button>}
        </div>
        {importOpen && <CsvImportDialog onClose={() => setImportOpen(false)} modulesAllowed={canImport} missingPlanning={!hasPlanning}/>}
      </>}
      {linkError && <p className="field-error" role="alert">{linkError}</p>}
      {s.key === "diary" && pro && (
        <form
          className="product-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearched(query.trim());
          }}
        >
          <Search size={18} />
          <input
            aria-label={t("Поиск в дневнике")}
            placeholder={t("Найти мысль или событие…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          <button className="button secondary" type="submit">
            {t("Найти")}
          </button>
          {searched && (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setQuery("");
                setSearched("");
              }}
            >
              {t("Сбросить")}
            </button>
          )}
        </form>
      )}
      {data.error && (
        <div role="alert" className="product-error">
          {data.error}
          <button className="text-button" onClick={() => void data.load()}>
            {t("Повторить")}
          </button>
        </div>
      )}
      {data.loading ? (
        <div className="product-loading" role="status">
          <LoaderCircle size={24} className="spinner" />
          {t("Загружаем записи…")}
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          title={
            searched ? t("Ничего не найдено") : t("Здесь начинается ваша история")
          }
          text={searched ? t("Попробуйте другое слово.") : s.description}
          action={searched ? undefined : t("Добавить первую запись")}
          onAction={() => setEditor({})}
        />
      ) : (
        <div className={`record-grid record-layout-${s.key}`}>
          {data.rows.map((row) => (
            <article className={`record-card record-${s.key}`} key={row.id}>
              <div className="record-head">
                <span className="record-eyebrow">{subtitle(s, row)}</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label={t("Изменить {0}", text(row.title) || s.singular)}
                    onClick={() => setEditor(row)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("Удалить {0}", text(row.title) || s.singular)}
                    onClick={() => setDeleting(row)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {s.key==='books'&&<button className="life-shelf-cover" onClick={()=>showDetail(row)} aria-label={t("Открыть ")+row.title}><BookCover book={row}/></button>}
              <RecordContent section={s} row={row} user={user} />
              {s.key==='programs'&&<button className="button secondary" onClick={()=>openWorkout(row)}>{t("Начать")}</button>}
              {s.key==='diary'&&Array.isArray(row.tags)&&row.tags.length>0&&<div className="life-diary-tags">{row.tags.map((tag,index)=><button key={index} disabled={!pro} onClick={()=>{setQuery(String(tag));setSearched(String(tag));}}>{String(tag)}</button>)}</div>}
              {s.key === "habits" && (
                <button
                  className="text-button"
                  disabled={!!busyId}
                  onClick={async () => {
                    setBusyId(row.id);
                    try {
                      await api("/habits/" + row.id, {
                        method: "PATCH",
                        body: {
                          ...bodyFor(s, row),
                          archived: !row.archived,
                          version: row.version,
                        },
                      });
                      await data.load();
                    } catch (e) {
                      notify(errorMessage(e), "error");
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  {row.archived ? t("Вернуть из архива") : t("В архив")}
                </button>
              )}
              <div className="record-bottom">
                {s.key === "habits" ? (
                  <>
                    <button
                      className={`button ${row.today_complete ? "secondary" : "primary"}`}
                      disabled={
                        !!busyId ||
                        Boolean(row.archived) ||
                        !((row.weekdays as number[]) || []).includes(
                          (new Date(day + "T12:00:00").getDay() + 6) % 7,
                        )
                      }
                      onClick={() => void toggle(row)}
                    >
                      {row.today_complete ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}{" "}
                      {row.today_complete ? t("Выполнено") : t("Отметить сегодня")}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => showDetail(row)}
                    >
                      {t("История")}
                      <ChevronRight size={14} />
                    </button>
                  </>
                ) : ["goals", "medications", "debts", "savings"].includes(
                    s.key,
                  ) ? (
                  <button
                    className="text-button"
                    onClick={() => showDetail(row)}
                  >
                    {s.key === "goals"
                      ? t("Открыть цель")
                      : s.key === "debts"
                        ? t("Погашения")
                        : s.key === "savings"
                          ? t("История баланса")
                          : t("Отметки приёма")}
                    <ArrowRight size={15} />
                  </button>
                ) : s.key === "diary" ? (
                  <button
                    className="text-button"
                    onClick={() => showDetail(row)}
                  >
                    {t("Читать запись")}
                    <ArrowRight size={15} />
                  </button>
                ) : <button className="text-button" onClick={() => showDetail(row)}>{t("Открыть")}<ArrowRight size={15}/></button>}
              </div>
            </article>
          ))}
        </div>
      )}
      {data.more && (
        <button
          className="button secondary load-more"
          disabled={data.busy}
          onClick={() => void data.load(data.rows.length)}
        >
          {t("Показать ещё")}
        </button>
      )}
      {smart && (
        <SmartGuide
          onClose={() => setSmart(false)}
          onComplete={(values) => {
            setSmart(false);
            setEditor(values);
          }}
        />
      )}
      {editor && (
        <RecordEditor
          section={s}
          initial={editor}
          user={user}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            await api(s.path + (editor.id ? "/" + editor.id : ""), {
              method: editor.id ? "PATCH" : "POST",
              body: {
                ...body,
                ...(editor.id ? { version: editor.version } : {}),
              },
            });
            await data.load();
            notify(t("Запись сохранена"));
            setEditor(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("Удалить запись?")}
          description={t("Запись исчезнет из этого раздела. Остальные записи останутся на месте.")}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(
              s.path + "/" + deleting.id + "?version=" + deleting.version,
              { method: "DELETE" },
            );
            await data.load();
            notify(t("Запись удалена"));
          }}
        />
      )}
      {catalog && (
        <Catalog
          onClose={() => setCatalog(false)}
          onSelect={(row) => {
            setCatalog(false);
            setEditor(row);
          }}
        />
      )}
      {detail && (
        <RecordDetail
          section={s}
          initial={detail}
          user={user}
          onClose={() => { closeDetail(); void data.load(); }}
          onEdit={() => { closeDetail(); setEditor(detail); }}
          notify={notify}
        />
      )}
    </section>
  );
}
function subtitle(s: Section, r: Row) {
  if (r.day) return dateLabel(r.day);
  if (r.month) return text(r.month);
  if (r.next_payment)
    return t("Платёж ") + dateLabel(r.next_due || r.next_payment);
  if (r.status)
    return (
      s.fields
        .find((f) => f.key === "status")
        ?.options?.find((o) => o[0] === r.status)?.[1] || text(r.status)
    );
  if (s.key === "sleep") return dateLabel(r.end_at);
  if (s.key === "habits")
    return r.archived
      ? t("В архиве")
      : (r.weekdays as number[])
          .map((x) => [t("Пн"), t("Вт"), t("Ср"), t("Чт"), t("Пт"), t("Сб"), t("Вс")][x])
          .join(" · ");
  return s.singular;
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="record-progress">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value)}%</strong>
      </div>
      <progress
        value={Math.min(100, Math.max(0, value))}
        max={100}
        aria-label={label}
      />
    </div>
  );
}
function RecordContent({
  section: s,
  row: r,
  user,
}: {
  section: Section;
  row: Row;
  user: User;
}) {
  return (
    <>
      <h3>
        {text(r.title) ||
          (s.key === "weight"
            ? amount(displayWeight(r.kg, user.weight_unit)) +
              " " +
              weightLabel(user.weight_unit)
            : s.key === "sleep"
              ? amount(
                  (Date.parse(text(r.end_at)) - Date.parse(text(r.start_at))) /
                    3600000,
                ) + t(" ч сна")
              : s.key === "diary"
                ? t("Мысли дня")
                : text(r.category))}
      </h3>
      {!!r.author && <p className="muted">{text(r.author)}</p>}
      {!!r.description && (
        <p className="record-description">{text(r.description)}</p>
      )}
      {s.key === "goals" && (
        <>
          <Progress value={Number(r.progress)} label={t("Прогресс цели")} />
          {!!r.due_date && <small>{t("До")} {dateLabel(r.due_date)}</small>}
        </>
      )}
      {s.key === "habits" && (
        <p className="record-metric">
          {amount(r.today_value)} / {amount(r.target)}{" "}
          <small>{text(r.unit) || t("за сегодня")}</small>
        </p>
      )}
      {s.key === "programs" && (
        <div>
          {(
            r.exercises as {
              name: string;
              sets: number;
              reps: number;
              kg: number | null;
            }[]
          ).map((e, i) => (
            <p key={i}>
              {e.name} · {e.sets} × {e.reps}
              {e.kg !== null ? " · " + e.kg + t(" кг") : ""}
            </p>
          ))}
        </div>
      )}
      {s.key === "workouts" && (
        <p className="record-metric">
          {amount(r.minutes)} <small>{t("минут")}</small>
        </p>
      )}
      {s.key === "sleep" && (
        <p className="muted">{t("Качество")} {text(r.quality)} {t("из 5")}</p>
      )}
      {s.key === "nutrition" && (
        <>
          <p className="record-metric">
            {amount(r.calories)} <small>{t("ккал")}</small>
          </p>
          <p className="muted">{t("Б")} {amount(r.protein)} {t("· Ж")} {amount(r.fat)} {t("· У")} {amount(r.carbs)}
          </p>
        </>
      )}
      {s.key === "medications" && (
        <>
          <p>{text(r.dosage)}</p>
          <p className="muted">{(r.times as string[]).join(" · ")}</p>
        </>
      )}
      {r.amount !== undefined && (
        <p className={`record-metric ${r.kind === "income" ? "income" : ""}`}>
          {r.kind === "expense" ? "−" : r.kind === "income" ? "+" : ""}
          {amount(r.amount)} <small>{text(r.currency)}</small>
        </p>
      )}
      {s.key === "saving-goals" && (
        <>
          <Progress
            value={(Number(r.saved) / Number(r.target)) * 100}
            label={t("Накоплено")}
          />
          <p>
            {amount(r.saved)} / {amount(r.target)} {text(r.currency)}
          </p>
          <small>{t("До")} {dateLabel(r.due_date)}</small>
          {r.monthly_needed !== undefined && (
            <p className="muted">
              {t("Откладывать примерно")} {amount(r.monthly_needed)} {text(r.currency)}{" "}
              {t("/ мес.")}
            </p>
          )}
        </>
      )}
      {s.key === "books" && (
        <>
          <Progress
            value={
              r.total_pages
                ? (Number(r.current_page) / Number(r.total_pages)) * 100
                : 0
            }
            label={t("{0} / {1} страниц", text(r.current_page), r.total_pages || "?")}
          />
          {!!r.rating && (
            <p aria-label={t("Оценка {0} из 5", r.rating)}>
              {"★".repeat(Number(r.rating))}
              {"☆".repeat(5 - Number(r.rating))}
            </p>
          )}
        </>
      )}
      {s.key === "diary" && (
        <p className="diary-preview">
          {text(r.text).slice(0, 100)}
          {text(r.text).length > 100 ? "…" : ""}
        </p>
      )}
    </>
  );
}
export function RecordEditor({
  section: s,
  initial,
  user,
  onSave,
  onClose,
}: {
  section: Section;
  initial: Record<string, unknown>;
  user: User;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const fields = [
    ...s.fields.map((f) =>
      s.key === "weight" && f.key === "kg"
        ? {
            ...f,
            label: t("Вес, ") + weightLabel(user.weight_unit),
            max: displayWeight(1000, user.weight_unit),
          }
        : f.key === "category" && isPro(user)
          ? {
              ...f,
              type: "text" as const,
              hint: t("Еда, транспорт, дом — или своя категория."),
            }
          : f,
    ),
    ...(s.key === "books" && isPro(user)
      ? [
          {
            key: "notes",
            label: t("Заметки о книге"),
            type: "textarea" as const,
            optional: true,
          },
        ]
      : []),
  ];
  const [values, setValues] = useState<Record<string, unknown>>(() => {
      const out = { ...initial };
      if (s.key === "weight" && out.kg !== undefined)
        out.kg = displayWeight(out.kg, user.weight_unit).toFixed(3);
      for (const f of fields) {
        if (out[f.key] === undefined)
          out[f.key] =
            f.initial ??
            (!f.optional && f.type === "date"
              ? todayKey(user.timezone)
              : f.type === "month"
                ? todayKey(user.timezone).slice(0, 7)
                : "");
        if (f.type === "datetime-local" && out[f.key]) {
          const d = new Date(text(out[f.key]));
          out[f.key] = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        }
      }
      return out;
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const close = () => {
    if (busy) return;
    if (s.key !== "diary" || !changed || window.confirm(t("Закрыть запись без сохранения?"))) onClose();
  };
  const renderField = (f: (typeof fields)[number]) => (
    <FieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => {
      setChanged(true);
      setValues((old) => ({ ...old, [f.key]: v }));
    }}/>
  );
  const notes = fields.find(field => field.key === "notes" && field.optional);
  return (
    <Modal
      title={`${initial.id ? t("Изменить") : t("Добавить")} · ${s.singular.toLowerCase()}`}
      onClose={close}
      className={`product-modal hub-record-editor${s.key === "diary" ? " diary-editor" : ""}`}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const body = bodyFor(s, values);
            if (s.key === "weight")
              body.kg = storeWeight(values.kg, user.weight_unit);
            await onSave(body);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body product-form">
          {fields.filter(f => f !== notes).map(renderField)}
          {notes && <details className="hub-disclosure" open={Boolean(initial.notes)}>
            <summary>{notes.label}</summary>
            <div>{renderField(notes)}</div>
          </details>}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            {t("Отмена")}
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spinner" />}{t("Сохранить")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function FieldControl({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = "field-" + f.key;
  if (f.type === "exercises") {
    const items = value as {
      name: string;
      sets: number;
      reps: number;
      kg: number | null;
    }[];
    return (
      <fieldset className="product-field full exercise-list">
        <legend>{f.label}</legend>
        <datalist id="exercise-catalog">
          {exerciseNames.map((name) => (
            <option key={name} value={t(name)} />
          ))}
        </datalist>
        <small>
          {t("Выберите название из справочника или введите своё. Подходы и нагрузку задайте по своей программе.")}
        </small>
        {items.map((item, i) => (
          <div key={i}>
            <label>
              {t("Упражнение")} {i + 1}
              <input
                list="exercise-catalog"
                required
                value={item.name}
                maxLength={200}
                onChange={(e) =>
                  onChange(
                    items.map((v, j) =>
                      i === j ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
            {(["sets", "reps", "kg"] as const).map((key, n) => (
              <label key={key}>
                {[t("Подходы"), t("Повторы"), t("Вес, кг")][n]}
                <input
                  type="number"
                  required={key !== "kg"}
                  min={key === "kg" ? 0 : 1}
                  step={key === "kg" ? ".1" : "1"}
                  max={key === "sets" ? 100 : 1000}
                  value={item[key] ?? ""}
                  onChange={(e) =>
                    onChange(
                      items.map((v, j) =>
                        i === j
                          ? {
                              ...v,
                              [key]:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            }
                          : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="icon-button"
              type="button"
              disabled={items.length === 1}
              aria-label={t("Убрать упражнение ") + (i + 1)}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="button secondary"
          type="button"
          disabled={items.length >= 100}
          onClick={() =>
            onChange([...items, { name: "", sets: 3, reps: 10, kg: null }])
          }
        >
          {t("Добавить упражнение")}
        </button>
      </fieldset>
    );
  }
  if (f.type === "weekdays")
    return (
      <fieldset className="product-field">
        <legend>{f.label}</legend>
        <div className="weekday-picker">
          {[t("Пн"), t("Вт"), t("Ср"), t("Чт"), t("Пт"), t("Сб"), t("Вс")].map((name, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={(value as number[]).includes(i)}
              onClick={() =>
                onChange(
                  (value as number[]).includes(i)
                    ? (value as number[]).filter((x) => x !== i)
                    : [...(value as number[]), i],
                )
              }
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
    );
  if (f.type === "times")
    return (
      <fieldset className="product-field">
        <legend>{f.label}</legend>
        <div className="time-picker">
          {(value as string[]).map((v, i) => (
            <label key={i}>
              <span className="sr-only">{t("Приём")} {i + 1}</span>
              <input
                type="time"
                required
                value={v}
                onChange={(e) =>
                  onChange(
                    (value as string[]).map((old, j) =>
                      i === j ? e.target.value : old,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                disabled={(value as string[]).length === 1}
                aria-label={t("Убрать время {0}", v)}
                onClick={() =>
                  onChange((value as string[]).filter((_, j) => j !== i))
                }
              >
                <Trash2 size={16} />
              </button>
            </label>
          ))}
        </div>
        {(value as string[]).length < 12 && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange([...(value as string[]), "18:00"])}
          >
            {t("Добавить время")}
          </button>
        )}
      </fieldset>
    );
  return (
    <div className={`product-field ${f.type === "textarea" ? "full" : ""}`}>
      <label htmlFor={id}>
        {f.label}
        {f.optional && <span> {t("· необязательно")}</span>}
      </label>
      {f.type === "textarea" ? (
        <textarea
          id={id}
          required={!f.optional}
          rows={f.key === "text" ? 9 : 3}
          value={text(value)}
          maxLength={f.key === "text" ? 100000 : 20000}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : f.type === "select" ? (
        <select
          id={id}
          required={!f.optional}
          value={text(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {f.options?.map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={f.type || "text"}
          required={!f.optional}
          value={text(value)}
          min={f.min}
          max={f.max}
          step={f.step ?? (f.type === "number" ? "1" : undefined)}
          maxLength={300}
          onChange={(e) => onChange(e.target.value)}
        />
      )}{" "}
      {f.hint && <small>{f.hint}</small>}
      {f.type === "datetime-local" && (
        <small>
          {t("Часовой пояс устройства:")}{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </small>
      )}
    </div>
  );
}
function Catalog({
  onSelect,
  onClose,
}: {
  onSelect: (row: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  return (
    <Modal
      title={t("Найти книгу")}
      description={t("Поиск по названию или автору в Open Library")}
      onClose={onClose}
    >
      <div className="modal-body">
        <form
          className="product-search"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api<{ items: Record<string, unknown>[] }>(
                "/books/search?q=" + encodeURIComponent(query),
              );
              setRows(r.items);
              setSearched(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label={t("Название или автор")}
            required
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spinner" />
            ) : (
              <Search size={16} />
            )}
            {t("Найти")}
          </button>
        </form>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="catalog-results">
          {rows.map((row, i) => (
            <button key={i} onClick={() => onSelect(row)}>
              <BookOpen size={20} />
              <span>
                <strong>{text(row.title)}</strong>
                <small>{text(row.author)}</small>
              </span>
              <Plus size={18} />
            </button>
          ))}
        </div>
        {searched && !rows.length && (
          <p>
            {t("Книг не найдено. Попробуйте другое название или добавьте книгу вручную.")}
          </p>
        )}
      </div>
    </Modal>
  );
}
