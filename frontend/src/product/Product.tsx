import { t } from '../lib/language';
import { openQuickAdd } from '../lib/workspace';
import { WorkspaceBar } from '../components/WorkspaceBar';
import { Results } from './results/Results';
import { HealthOverview } from './HealthOverview';
import {HealthScreens,isHealthScreen} from './health/HealthScreens';
import { GoalsHabits } from './GoalsHabits';
import { Navigation } from '../components/Navigation';
import { Dashboard } from './Dashboard';
import { useEffect, useState } from 'react';
import { Crown, Plus } from 'lucide-react';
import { isDemo } from '../lib/api';
import type { User, Notify } from '../lib/types';
import { EmptyState } from '../components/ui';
import { Settings } from '../components/Settings';
import { sections } from './schema';
import { financeGroup } from './financeNavigation';
import { FinanceOverview } from './details';
import "./product.css";
import { isPro } from './recordPresentation';
import { Records } from './Records';

const names: Record<string, string> = {
  dashboard: t("Главная"),
  planning: t("Планирование"),
  goals_habits: t("Цели и привычки"),
  health: t("Здоровье"),
  finance: t("Финансы"),
  books: t("Книги и дневник"),
};

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
  const group = module === 'finance' ? financeGroup(activeTab) : [];
  const primaryTabs = module === 'finance' ? tabs.filter(item => financeGroup(item.key)[0] === item.key) : tabs;
  const gotoTab = (key:string) => navigate(modulePath+'/'+key+(module==='finance'&&search?'?'+search:''));
  const title = names[module] ?? (module === 'insights' ? t("Итоги") : t("Страница недоступна"));
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
  if (module==='insights'&&!isDemo()) return <>
    <Results user={user} path={path} search={search} navigate={navigate} notify={notify} onSettings={()=>setSettings('profile')}/>
    {settings&&<Settings user={user} initialTab={settings} onClose={()=>setSettings(null)}
      onUserChange={onUserChange} onLogout={onLogout} notify={notify}/>}
  </>;
  if(module==='health'&&allowed&&!isDemo()&&isHealthScreen(tab)) return <>
    <HealthScreens key={tab} tab={tab} id={recordId} path={path} user={user} pro={pro} navigate={navigate}
      onSettings={()=>setSettings('profile')} onUpgrade={()=>setSettings('plan')}/>
    {settings&&<Settings user={user} initialTab={settings} onClose={()=>setSettings(null)}
      onUserChange={onUserChange} onLogout={onLogout} notify={notify}/>}
  </>;
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
            <h1>{healthOverview?t("Обзор"):financeOverview?t("Аналитика"):module==='goals_habits'?(tab==='goals'?t("Цели"):tab==='habits'?t("Привычки"):tab==='stats'?t("Статистика"):t("Сегодня")):title}</h1>
            {healthOverview&&<p className="life-page-subtitle">{t("Сон, вес и движение за неделю")}</p>}
          </div>{healthOverview&&<button className="button primary" onClick={()=>openQuickAdd()}><Plus size={16}/>{t("Записать")}</button>}</header>}
          {isDemo() ? <EmptyState title={t("Откройте свой аккаунт")} text={t("Войдите, чтобы сохранять записи в модулях.")} action={t("Перейти ко входу")} onAction={onLogout}/>
            : module === 'dashboard' ? <Dashboard key={user.id} user={user} navigate={navigate} notify={notify} onProfile={()=>setSettings('profile')}/>
            : !names[module] || (tab && !tabs.some(item => item.key === tab) && module !== 'goals_habits') ?
              <EmptyState title={t("Такой страницы нет")} text={t("Вернитесь на главную или выберите модуль в меню.")} action={t("На главную")} onAction={() => navigate('/home')}/>
            : !allowed ? <Locked onPlan={() => setSettings('plan')} module/>
            : module === 'goals_habits' ? <>
              <nav className="product-tabs life-goals-tabs" aria-label={t("Разделы целей и привычек")}>{[['',t("Сегодня")],['habits',t("Привычки")],['goals',t("Цели")],['stats',t("Статистика")]].map(([key,label])=><button key={key} className={(tab??'')===key?'active':''} onClick={()=>navigate(modulePath+(key?'/'+key:''))}>{label}</button>)}</nav>
              <GoalsHabits user={user} notify={notify} view={tab} onDaySelected={()=>navigate(modulePath)} create={new URLSearchParams(search).get('new')} preset={new URLSearchParams(search).get('preset')}/>
            </>
            : <>
              <nav className="product-tabs" aria-label={t("Подразделы")}>
                {primaryTabs.map(item => <button key={item.key} aria-current={item.key===(group[0]??activeTab)?'page':undefined}
                  className={item.key===(group[0]??activeTab)?'active':''} onClick={() => gotoTab(item.key)}>
                  {item.label}{item.pro&&!pro&&<Crown size={13}/>}
                </button>)}
              </nav>
              {group.length>1 && <nav className="finance-subnav" aria-label={t("Подразделы финансов")}>
                {group.map(key => <button key={key} type="button" aria-current={key===activeTab?'page':undefined} onClick={()=>gotoTab(key)}>
                  {tabs.find(item=>item.key===key)?.label}
                </button>)}
              </nav>}
              {healthOverview ? <HealthOverview user={user} navigate={navigate} showConnection={new URLSearchParams(search).has('connect')}/>
                : financeOverview ? pro ? <><FinanceOverview user={user} revision={search} analysis
                    preferences={new URLSearchParams(search)} onSelect={params => navigate(modulePath+'/analysis?'+params)}
                    onCategory={params => navigate(modulePath+'/transactions?'+params)}/>
                  <button className="text-button" type="button" onClick={()=>navigate('/modules/insights/archive?kind=month')}>
                    {t('Разобрать месяц с ИИ')}
                  </button></> : <Locked onPlan={() => setSettings('plan')}/>
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
