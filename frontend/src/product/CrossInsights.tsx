import { t } from '../lib/language';
import {LifeCard,LifeRings} from '../components/LifeCard';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Heart,LoaderCircle,RefreshCw,Sparkles,Target,Trash2,Wallet} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,shiftDay,todayKey} from '../lib/dates';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {AssistantPreferences} from '../components/AssistantPreferences';
import {ConfirmDialog} from '../components/ui';
import type {User} from '../lib/types';
import './cross-insights.css';

const modules={planning:t("Планирование"),goals_habits:t("Привычки"),health:t("Здоровье"),finance:t("Финансы"),books:t("Дневник")};
type Module=keyof typeof modules;
type Metric={key:string;module:Module;label:string;unit:string;recorded_days:number;values:Record<string,string>};
type Comparison={id:string;modules:Module[];x:string;y:string;text:string;paired_days:number;threshold:string;evidence:{day:string;x:string;y:string;group:'lower'|'upper'}[]};
type Data={start_day:string;end_day:string;days:number;modules:Module[];currency:string;metrics:Metric[];comparisons:Comparison[];coverage:{x:string;y:string;paired_days:number;comparable:boolean}[];notes:string[];limitation:string;source_hash:string;review:{id:string;status:string;updated_at:string;output:{comparison_ids:string[]}|null}|null};

export function CrossInsights({user,pro,navigate,view}:{user:User;pro:boolean;navigate:(path:string)=>void;view?:string}){
  const yesterday=shiftDay(todayKey(user.timezone),-1);
  const [end,setEnd]=useState(yesterday),[days,setDays]=useState(14),[selected,setSelected]=useState<Module[]>(['planning','goals_habits']),[currency,setCurrency]=useState('PLN');
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [consent,setConsent]=useState(false),[settings,setSettings]=useState(false),[deleting,setDeleting]=useState(false);
  const {preferences,loading:preferencesLoading}=useAssistantPreferences(user.id);
  const serial=useRef(0),alive=useRef(true),generating=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++;};},[]);
  const load=useCallback(async()=>{
    const request=++serial.current;
    if(!pro||selected.length<2||!end){setLoading(false);return;}
    setLoading(true);
    try{const query=new URLSearchParams({end_day:end,days:String(days),currency});selected.forEach(module=>query.append('modules',module));const result=await api<Data>('/dashboard/insights?'+query);if(alive.current&&request===serial.current){setData(result);setError('');}}
    catch(e){if(alive.current&&request===serial.current){setData(null);setError(errorMessage(e));}}
    finally{if(alive.current&&request===serial.current)setLoading(false);}
  },[end,days,selected,currency,pro,user.id,user.timezone]);
  useEffect(()=>{setData(null);setError('');setConsent(false);void load();},[load]);
  useEffect(()=>{const changed=()=>{setData(null);setConsent(false);void load();};window.addEventListener('lifehub:data-changed',changed);window.addEventListener('focus',changed);return()=>{window.removeEventListener('lifehub:data-changed',changed);window.removeEventListener('focus',changed);};},[load]);
  useEffect(()=>{if(data?.review?.status!=='processing'||busy)return;const timer=window.setTimeout(()=>void load(),3000);return()=>window.clearTimeout(timer);},[data,busy,load]);
  async function generate(){
    if(!data||!consent||generating.current)return;generating.current=true;setBusy(true);setError('');const request=++serial.current;
    try{const result=await api<Data>('/dashboard/insights',{method:'POST',body:{end_day:end,days,modules:selected,currency,source_hash:data.source_hash,consent:true}});if(alive.current&&request===serial.current){setData(result);setConsent(false);}}
    catch(e){if(alive.current&&request===serial.current)setError(errorMessage(e));}
    finally{generating.current=false;if(alive.current)setBusy(false);}
  }
  function moduleChange(module:Module){setSelected(old=>old.includes(module)?old.filter(value=>value!==module):[...old,module].sort());}
  const metric=(key:string)=>data?.metrics.find(value=>value.key===key);
  const output=data?.review?.output;
  const running=data?.review?.status==='processing'&&Date.now()-Date.parse(data.review.updated_at)<180000;
  const permitted=preferences.messages&&preferences.modules;
  const comparison=(value:Comparison)=><article className="cross-comparison" key={value.id}><p>{value.text}</p><div className="cross-source-links">{value.modules.map(module=><button key={module} type="button" onClick={()=>navigate(module==='planning'?'/planning':'/modules/'+module)}>{modules[module]}<ArrowRight size={13}/></button>)}</div><details><summary>{t("Основания по дням ·")} {value.paired_days} {t("дней")}</summary><p className="cross-note">{t("Группы определены относительно личной медианы первого показателя:")} {value.threshold} {metric(value.x)?.unit}{t(". Ниже — только даты с записями обоих показателей.")}</p><div className="cross-evidence"><table><caption>{t("Дневные показатели из записей")}</caption><thead><tr><th>{t("Дата")}</th><th>{metric(value.x)?.label}, {metric(value.x)?.unit}</th><th>{metric(value.y)?.label}, {metric(value.y)?.unit}</th><th>{t("Группа")}</th></tr></thead><tbody>{value.evidence.map(row=><tr key={row.day}><td>{dayLabel(row.day,{day:'numeric',month:'short'})}</td><td>{row.x}</td><td>{row.y}</td><td>{row.group==='lower'?t("Ниже"):t("Не ниже")} {t("медианы")}</td></tr>)}</tbody></table></div></details></article>;
  useEffect(()=>{
    if(view==='review'&&data)document.getElementById('life-ai-review')?.scrollIntoView({block:'start'});
    if(view==='comparisons'&&data)document.getElementById('life-comparisons')?.scrollIntoView({block:'start'});
  },[view,data?.source_hash]);
  const best=Math.max(0,...(data?.coverage.map(pair=>pair.paired_days)??[]));
  const icons={planning:CalendarDays,goals_habits:Target,health:Heart,finance:Wallet,books:BookOpen};
  const themes={planning:'plans',goals_habits:'habits',health:'health',finance:'finance',books:'books'};
  return <section className="cross-insights life-cross" aria-label={t("Межмодульный обзор")}>
    <button type="button" className="button secondary life-cross-refresh" disabled={busy||loading||!pro||selected.length<2} onClick={()=>{setData(null);setConsent(false);void load();}}><RefreshCw size={15}/>{t("Обновить")}</button>
    {!pro?<LifeCard><p>{t("Обзор доступен с Pro или в пробном периоде.")}</p></LifeCard>:<>
      <div className="life-cross-grid">
        <LifeCard><h3><i>1</i>{t("Что сравнить")}</h3><div className="cross-module-options">
          {(Object.keys(modules) as Module[]).map(key=>{const Icon=icons[key];return <button type="button" key={key} disabled={busy} aria-pressed={selected.includes(key)} className={'theme-'+themes[key]} onClick={()=>moduleChange(key)}><Icon size={15}/>{modules[key]}</button>;})}
        </div><p>{t("Выберите минимум два модуля.")}</p></LifeCard>
        <LifeCard><h3><i>2</i>{t("Период")}</h3><div className="segmented">{[14,28].map(value=><button key={value} disabled={busy} aria-pressed={days===value} className={days===value?'selected':''} onClick={()=>setDays(value)}>{value} {t("дней")}</button>)}</div>
          <div className="cross-controls"><label>{t("Последний день")}<input type="date" value={end} min="1900-01-28" max={yesterday} disabled={busy} onChange={e=>{if(e.target.value)setEnd(e.target.value);}}/></label>{selected.includes('finance')&&<label>{t("Валюта")}<select value={currency} disabled={busy} onChange={e=>setCurrency(e.target.value)}>{['PLN','EUR','USD','RUB','UAH','GBP'].map(code=><option key={code}>{code}</option>)}</select></label>}</div>
          {data&&<p>{dayLabel(data.start_day)} — {dayLabel(data.end_day)} {t("· завершённые дни")}</p>}</LifeCard>
        <LifeCard><h3><i>3</i>{t("Данные")}</h3><div className="life-cross-days"><LifeRings size={70} label={best+t(" общих дней")} values={[{value:best/8,color:'#89600e',track:'#f3ead3'}]}/>
          <div><strong>{best>=8?best:best+t(" из 8")} {t("дней")}</strong><p>{t("Общих дней с записями")}</p></div></div><p>{best<8?t("Ещё ")+(8-best)+t(" дней с записями для первого сравнения."):t("Доступность зависит от записей и различий между группами.")}</p></LifeCard>
      </div>
      <div className="life-cross-results" id="life-comparisons">
        <h2>{view==='comparisons'?t("Все сравнения"):t("Что видно")}</h2>
        {selected.length<2&&<p className="cross-note">{t("Выберите ещё один модуль.")}</p>}
        {error&&<p className="field-error" role="alert">{error}</p>}
        {loading&&!data&&<p role="status"><LoaderCircle size={16} className="spinner"/>{t("Сопоставляю записи…")}</p>}
        {data&&<>
          {!data.comparisons.length&&<p className="cross-note">{t("Нужны 8 общих дней и минимум по 3 дня в каждой группе.")}</p>}
          <div className="life-comparisons">{data.comparisons.map(comparison)}</div>
          <details className="cross-coverage"><summary>{t("Какие данные есть")}</summary>
            <ul>{data.metrics.map(value=><li key={value.key}>{value.label}: {value.recorded_days} {t("дней с записями из")} {days}.</li>)}</ul>
            <ul>{data.coverage.map(pair=><li key={pair.x+':'+pair.y}>{metric(pair.x)?.label} + {metric(pair.y)?.label}{t(": общих дней")} {pair.paired_days}{pair.comparable?t(" · можно сравнить"):''}.</li>)}</ul>
            {data.notes.map(note=><p className="cross-note" key={note}>{note}</p>)}
          </details>
        </>}
      </div>
      {data&&<>
        <div className="cross-ai" id="life-ai-review"><h3><Sparkles size={18}/>{t("Наблюдения с ИИ")}</h3><p className="cross-note">{t("ИИ выбирает до трёх готовых сравнений. Числа, ограничения и таблицы оснований рассчитаны Life Hub; новые объяснения причин ИИ не добавляет.")}</p>
          {output?<>{output.comparison_ids.map(id=>{const value=data.comparisons.find(item=>item.id===id);return value?comparison(value):null;})}<button type="button" className="button ghost" disabled={busy} onClick={()=>setDeleting(true)}><Trash2 size={15}/>{t("Удалить обзор")}</button></>:<>
            {!permitted&&!preferencesLoading&&<p className="cross-note">{t("Для ИИ включите сообщения и доступ к модулям.")} <button type="button" className="text-button" onClick={()=>setSettings(!settings)}>{t("Настройки доступа")}</button></p>}{settings&&<AssistantPreferences userId={user.id}/>}
            {data.review?.status==='failed'&&<p className="cross-note">{t("Предыдущая попытка не завершилась. Можно повторить.")}</p>}
            <label className="cross-consent"><input type="checkbox" checked={consent} disabled={busy||running} onChange={e=>setConsent(e.target.checked)}/>{t("Разрешаю отправить в OpenAI рассчитанные сравнения выбранных модулей: периоды, средние значения, медианы и число общих дней.")}{selected.includes('health')?t(" Включая выбранные показатели здоровья — длительность сна и тренировок."):''}{selected.includes('books')?t(" Включая средние оценки настроения, если вы их отмечали."):''} {t("Тексты дневника, названия задач и покупок, заметки, лекарства, вес, исходные файлы и другие модули не передаются.")}</label>
            <button type="button" className="button primary" disabled={busy||loading||running||preferencesLoading||!permitted||!consent||!data.comparisons.length} onClick={()=>void generate()}>{busy||running?<LoaderCircle size={16} className="spinner"/>:<Sparkles size={16}/>} {busy||running?t("Выбираю наблюдения…"):t("Подготовить обзор с ИИ")}</button>
          </>}
          <p className="cross-note">{t("Расчёты бесплатны по лимиту ИИ; генерация использует один общий запрос, повторное открытие готового обзора — без нового запроса. При обновлении данных изменённые записи скрывают старый обзор. Кэш удаляется после 30 дней без генерации. Записи и расписание автоматически не меняются.")}</p>
        </div>
      </>}
      {deleting&&data?.review&&<ConfirmDialog title={t("Удалить обзор?")} description={t("Удалится только подборка наблюдений. Записи выбранных модулей останутся.")} confirmLabel={t("Удалить обзор")} onClose={()=>setDeleting(false)} onConfirm={async()=>{await api(`/dashboard/insights/${data.review!.id}`,{method:'DELETE'});await load();}}/>}
    </>}
  </section>;
}
