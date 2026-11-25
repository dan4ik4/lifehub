import {Navigation} from '../../components/Navigation';
import {dateKey,todayKey} from '../../lib/dates';
import {t} from '../../lib/language';
import type {User} from '../../lib/types';
import {openAssistant} from '../../lib/workspace';
import {formatAmount} from '../format';
import {displayWeight} from '../weight';
import {MedicationScreen,NutritionScreen} from './NutritionMedications';
import {ProgramsScreen} from './Programs';
import {SleepScreen,WeightScreen} from './SleepWeight';
import {clock,healthRoot,healthTabs,HIcon,summaryPath,totals,useHealthData} from './shared';
import type {HealthSummary,HealthTab,MedicationSlot,MedicationTracking,Program} from './shared';
import './health.css';

const sections=['sleep','weight','programs','nutrition','medications'] as const;
export function isHealthScreen(tab:string|undefined):tab is HealthTab {
  return sections.some(key=>key===tab);
}

export function HealthScreens({user,tab,id,path,pro,onUpgrade,onSettings,navigate}:{user:User;tab:HealthTab;id?:string;path:string;
  pro:boolean;onUpgrade:()=>void;onSettings:()=>void;navigate:(to:string)=>void}) {
  const today=todayKey(user.timezone);
  const recent=useHealthData<HealthSummary>(summaryPath(today,7));
  const weights=useHealthData<{widgets:{weight?:{kg:string}[]}}>('/dashboard');
  const programs=useHealthData<{items:Program[];has_more?:boolean}>(pro?'/health/programs':null);
  const slots=useHealthData<{items:MedicationSlot[]}>(pro?'/health/medication-schedule?day='+today:null);
  const tracking=useHealthData<MedicationTracking>(pro&&tab==='medications'?'/health/medication-tracking':null);
  const last=recent.data?.sleep.at(-1), device=recent.data?.device_days?.filter(day=>day.sleep_seconds!==null).at(-1);
  const weight=weights.data?.widgets.weight?.at(-1);
  const meals=recent.data?.nutrition?.filter(row=>row.day===today);
  const badges={
    sleep:device?.sleep_seconds!=null&&(!last||device.day>dateKey(last.end_at,user.timezone))?clock(device.sleep_seconds/60):
      last?clock((Date.parse(last.end_at)-Date.parse(last.start_at))/60000):undefined,
    weight:weight?formatAmount(displayWeight(weight.kg,user.weight_unit).toFixed(1)):undefined,
    workouts:recent.data?.workouts.length?String(recent.data.workouts.length):undefined,
    programs:programs.data?.items.length?String(programs.data.items.length)+(programs.data.has_more?'+':''):undefined,
    nutrition:meals?.length?formatAmount(totals(meals).calories):undefined,
    medications:slots.data?.items.length?slots.data.items.filter(slot=>slot.taken).length+'/'+slots.data.items.length:undefined,
  };
  const props={user,today,pro,id,onUpgrade,navigate};
  return <div className={'app-layout health-layout'+(tab==='sleep'?' health-night':'')}>
    <Navigation user={user} path={path} navigate={navigate} onSettings={onSettings} healthBadges={badges}/>
    <div className="app-main product-layout">
      <a className="skip-link" href="#health-main">{t('Перейти к содержимому')}</a>
      <main className="health-main" id="health-main">
        <nav className="health-compact-tabs" aria-label={t('Разделы здоровья')}>{healthTabs.map(([key,label,icon])=>
          <button type="button" key={key} aria-current={key===tab?'page':undefined} onClick={()=>navigate(healthRoot+(key==='overview'?'':'/'+key))}>
            <HIcon name={icon} size={14}/>{label}</button>)}</nav>
        {tab==='sleep'?<SleepScreen {...props}/>:tab==='weight'?<WeightScreen {...props}/>:
          tab==='programs'?<ProgramsScreen {...props} programs={programs}/>:
          tab==='nutrition'?<NutritionScreen {...props}/>:<MedicationScreen {...props} tracking={tracking} slots={slots}/>}
        <footer className="health-assistant-row"><button className="health-assistant" type="button" onClick={()=>openAssistant()}>
          <HIcon name="sparkles" size={20}/>{t('Спросить помощника')}<kbd>⌘J</kbd></button></footer>
      </main>
    </div>
  </div>;
}
