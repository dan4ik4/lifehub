import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Layers,LoaderCircle,RefreshCw,Sparkles,Trash2} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,shiftDay,todayKey} from '../lib/dates';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {AssistantPreferences} from '../components/AssistantPreferences';
import {ConfirmDialog} from '../components/ui';
import type {User} from '../lib/types';
import './cross-insights.css';

const modules={planning:'Планирование',goals_habits:'Привычки',health:'Здоровье',finance:'Финансы',books:'Дневник'};
type Module=keyof typeof modules;
type Metric={key:string;module:Module;label:string;unit:string;recorded_days:number;values:Record<string,string>};
type Comparison={id:string;modules:Module[];x:string;y:string;text:string;paired_days:number;threshold:string;evidence:{day:string;x:string;y:string;group:'lower'|'upper'}[]};
type Data={start_day:string;end_day:string;days:number;modules:Module[];currency:string;metrics:Metric[];comparisons:Comparison[];coverage:{x:string;y:string;paired_days:number;comparable:boolean}[];notes:string[];limitation:string;source_hash:string;review:{id:string;status:string;updated_at:string;output:{comparison_ids:string[]}|null}|null};

export function CrossInsights({user,pro,navigate}:{user:User;pro:boolean;navigate:(path:string)=>void}){
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
  const comparison=(value:Comparison)=><article className="cross-comparison" key={value.id}><p>{value.text}</p><div className="cross-source-links">{value.modules.map(module=><button key={module} type="button" onClick={()=>navigate(module==='planning'?'/planning':'/modules/'+module)}>{modules[module]}<ArrowRight size={13}/></button>)}</div><details><summary>Основания по дням · {value.paired_days} дней</summary><p className="cross-note">Группы определены относительно личной медианы первого показателя: {value.threshold} {metric(value.x)?.unit}. Ниже — только даты с записями обоих показателей.</p><div className="cross-evidence"><table><caption>Дневные показатели из записей</caption><thead><tr><th>Дата</th><th>{metric(value.x)?.label}, {metric(value.x)?.unit}</th><th>{metric(value.y)?.label}, {metric(value.y)?.unit}</th><th>Группа</th></tr></thead><tbody>{value.evidence.map(row=><tr key={row.day}><td>{dayLabel(row.day,{day:'numeric',month:'short'})}</td><td>{row.x}</td><td>{row.y}</td><td>{row.group==='lower'?'Ниже':'Не ниже'} медианы</td></tr>)}</tbody></table></div></details></article>;
  return <section className="cross-insights" aria-label="Межмодульный обзор">
    <header><span className="cross-icon"><Layers size={22}/></span><div><h2>Что видно вместе</h2><p>Сравнение записей разных модулей за один период</p></div><button type="button" className="button secondary" disabled={busy||loading||!pro||selected.length<2} onClick={()=>{setData(null);setConsent(false);void load();}}><RefreshCw size={15}/>Обновить данные</button></header>
    {!pro?<p className="cross-note">Обзор доступен с Pro или в пробном периоде.</p>:<>
      <fieldset disabled={busy}><legend>Модули для обзора · выберите минимум два</legend><div className="cross-module-options">{Object.entries(modules).map(([key,label])=><label key={key}><input type="checkbox" checked={selected.includes(key as Module)} onChange={()=>moduleChange(key as Module)}/>{label}</label>)}</div></fieldset>
      <div className="cross-controls"><label>Последний день<input type="date" value={end} min="1900-01-28" max={yesterday} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label><label>Период<select value={days} disabled={busy} onChange={e=>setDays(Number(e.target.value))}><option value={14}>14 дней</option><option value={28}>28 дней</option></select></label>{selected.includes('finance')&&<label>Валюта расходов<select value={currency} disabled={busy} onChange={e=>setCurrency(e.target.value)}>{['PLN','EUR','USD','RUB','UAH','GBP'].map(code=><option key={code}>{code}</option>)}</select></label>}</div>
      <p className="cross-note">Сравниваются завершённые дни. Пропуски не превращаются в нули. Это наблюдения по вашим записям, а не доказательство связи или причины. Диагнозы и рекомендации по лечению, инвестициям или кредитам не формируются.</p>
      {selected.length<2&&<p className="cross-note">Выберите ещё один модуль, чтобы сравнить записи.</p>}
      {error&&<p className="field-error" role="alert">{error}</p>}
      {loading&&!data&&<p role="status"><LoaderCircle size={16} className="spinner"/>Сопоставляю записи…</p>}
      {data&&<>
        <p className="cross-note">{dayLabel(data.start_day)} — {dayLabel(data.end_day)}. Выбранные показатели: {data.metrics.length}.</p>
        <details className="cross-coverage"><summary>Какие данные есть</summary><ul>{data.metrics.map(value=><li key={value.key}>{value.label}: {value.recorded_days} дней с записями из {days}.</li>)}</ul><ul>{data.coverage.map(pair=><li key={pair.x+':'+pair.y}>{metric(pair.x)?.label} + {metric(pair.y)?.label}: общих дней {pair.paired_days}{pair.comparable?' · можно сравнить':' · пока недостаточно общих дней или различий'}.</li>)}</ul>{data.notes.map(note=><p className="cross-note" key={note}>{note}</p>)}</details>
        {!data.comparisons.length&&<p className="cross-note">Пока недостаточно данных для наблюдений. Для каждой пары нужны хотя бы 8 общих дней; после разделения по личной медиане — минимум по 3 дня в каждой группе. Ничего не достраивается за пропущенные дни.</p>}
        {data.comparisons.length>0&&<details className="cross-coverage"><summary>Все доступные сравнения ({data.comparisons.length})</summary>{data.comparisons.map(comparison)}</details>}
        <div className="cross-ai"><h3><Sparkles size={18}/>Наблюдения с ИИ</h3><p className="cross-note">ИИ выбирает до трёх готовых сравнений. Числа, ограничения и таблицы оснований рассчитаны Life Hub; новые объяснения причин ИИ не добавляет.</p>
          {output?<>{output.comparison_ids.map(id=>{const value=data.comparisons.find(item=>item.id===id);return value?comparison(value):null;})}<button type="button" className="button ghost" disabled={busy} onClick={()=>setDeleting(true)}><Trash2 size={15}/>Удалить обзор</button></>:<>
            {!permitted&&!preferencesLoading&&<p className="cross-note">Для ИИ включите сообщения и доступ к модулям. <button type="button" className="text-button" onClick={()=>setSettings(!settings)}>Настройки доступа</button></p>}{settings&&<AssistantPreferences userId={user.id}/>}
            {data.review?.status==='failed'&&<p className="cross-note">Предыдущая попытка не завершилась. Можно повторить.</p>}
            <label className="cross-consent"><input type="checkbox" checked={consent} disabled={busy||running} onChange={e=>setConsent(e.target.checked)}/>Разрешаю отправить в OpenAI рассчитанные сравнения выбранных модулей: периоды, средние значения, медианы и число общих дней.{selected.includes('health')?' Включая выбранные показатели здоровья — длительность сна и тренировок.':''} Тексты дневника, названия задач и покупок, заметки, лекарства, вес, исходные файлы и другие модули не передаются.</label>
            <button type="button" className="button primary" disabled={busy||loading||running||preferencesLoading||!permitted||!consent||!data.comparisons.length} onClick={()=>void generate()}>{busy||running?<LoaderCircle size={16} className="spinner"/>:<Sparkles size={16}/>} {busy||running?'Выбираю наблюдения…':'Подготовить обзор с ИИ'}</button>
          </>}
          <p className="cross-note">Расчёты бесплатны по лимиту ИИ; генерация использует один общий запрос, повторное открытие готового обзора — без нового запроса. При обновлении данных изменённые записи скрывают старый обзор. Кэш удаляется после 30 дней без генерации. Записи и расписание автоматически не меняются.</p>
        </div>
      </>}
      {deleting&&data?.review&&<ConfirmDialog title="Удалить обзор?" description="Удалится только подборка наблюдений. Записи выбранных модулей останутся." confirmLabel="Удалить обзор" onClose={()=>setDeleting(false)} onConfirm={async()=>{await api(`/dashboard/insights/${data.review!.id}`,{method:'DELETE'});await load();}}/>}
    </>}
  </section>;
}
