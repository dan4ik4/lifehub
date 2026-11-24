import { t } from '../lib/language';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw,Sparkles,Trash2} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,shiftDay,todayKey} from '../lib/dates';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {AssistantPreferences} from '../components/AssistantPreferences';
import {ConfirmDialog} from '../components/ui';
import type {User} from '../lib/types';
import './diary-review.css';

type Point={text:string;entry_ids:string[]};
type Output={summary:string;highlights:Point[];themes:Point[];reflection_question:string};
type Review={id:string;status:'processing'|'done'|'failed';output:Output|null;updated_at:string};
type Data={start_day:string;end_day:string;entry_count:number;recorded_days:string[];sources:{id:string;day:string;title:string}[];review:Review|null};

export function DiaryReview({user,pro,revision,onSource}:{user:User;pro:boolean;revision:unknown;onSource:(day:string)=>void}){
  const today=todayKey(user.timezone);
  const [end,setEnd]=useState(today),[data,setData]=useState<Data|null>(null),[error,setError]=useState('');
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [settings,setSettings]=useState(false),[deleting,setDeleting]=useState(false);
  const {preferences,loading:preferencesLoading}=useAssistantPreferences(user.id);
  const alive=useRef(true),requestNumber=useRef(0),generation=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;requestNumber.current++;};},[]);
  const load=useCallback(async()=>{
    if(!pro||!end)return;
    const number=++requestNumber.current;setLoading(true);
    try{const value=await api<Data>('/diary/weekly-review?end_day='+encodeURIComponent(end));if(alive.current&&number===requestNumber.current){setData(value);setError('');}}
    catch(e){if(alive.current&&number===requestNumber.current){setData(null);setError(errorMessage(e));}}
    finally{if(alive.current&&number===requestNumber.current)setLoading(false);}
  },[end,pro]);
  useEffect(()=>{setData(null);setError('');setConsent(false);void load();},[load,revision]);
  useEffect(()=>{
    if(data?.review?.status!=='processing'||busy)return;
    const timer=window.setTimeout(()=>void load(),3000);return()=>window.clearTimeout(timer);
  },[data,busy,load]);
  async function generate(){
    if(generation.current||!end)return;generation.current=true;setBusy(true);setError('');const number=++requestNumber.current;
    try{const value=await api<Data>('/diary/weekly-review',{method:'POST',body:{end_day:end,consent:true}});if(alive.current&&number===requestNumber.current)setData(value);}
    catch(e){if(alive.current&&number===requestNumber.current)setError(errorMessage(e));}
    finally{generation.current=false;if(alive.current)setBusy(false);}
  }
  const output=data?.review?.output;
  const permitted=preferences.messages&&preferences.modules;
  const inProgress=data?.review?.status==='processing'&&Date.now()-Date.parse(data.review.updated_at)<180000;
  const source=(id:string)=>data?.sources.find(s=>s.id===id);
  const point=(p:Point,index:number)=><li key={index}><p>{p.text}</p><div className="review-sources">{[...new Set(p.entry_ids)].map(id=>{const entry=source(id);return entry?<button key={id} type="button" onClick={()=>onSource(entry.day)} title={entry.title||t("Запись дневника")}>{dayLabel(entry.day,{day:'numeric',month:'short'})}{entry.title?' · '+entry.title:''}</button>:null;})}</div></li>;
  return <section className="diary-review" aria-label={t("Недельный обзор дневника")}>
    <header><span className="review-icon"><Sparkles size={21}/></span><div><h2>{t("Обзор семи дней")}</h2><p>{t("События и темы из ваших записей")}</p></div></header>
    {!pro?<p className="review-note">{t("Недельный обзор доступен с Pro или в пробном периоде.")}</p>:<>
      <div className="review-controls"><label>{t("Последний день периода")}<input type="date" value={end} min="1900-01-07" max={today} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label><button type="button" className="button secondary" disabled={busy||loading||!end} onClick={()=>void load()}><RefreshCw size={15}/>{t("Обновить")}</button></div>
      {data&&<p className="review-note">{dayLabel(data.start_day,{day:'numeric',month:'short'})} — {dayLabel(data.end_day,{day:'numeric',month:'short',year:'numeric'})}{t(". Записей:")} {data.entry_count}{t(", дней с записями:")} {data.recorded_days.length} {t("из 7. За остальные дни данных нет.")}</p>}
      {error&&<p className="field-error" role="alert">{error}</p>}
      {loading&&!data&&<p role="status"><LoaderCircle size={16} className="spinner"/>{t("Загружаю обзор…")}</p>}
      {data?.entry_count===0&&<p className="review-note">{t("За эти семь дней записей нет. Добавьте запись или выберите другой период.")}</p>}
      {data?.review?.status==='failed'&&<p className="review-note">{t("Предыдущая попытка не завершилась. Можно повторить создание обзора.")}</p>}
      {output?<div className="review-output"><span className="review-label">{t("Обзор ИИ · проверяйте выводы по исходным записям")}</span><p className="review-summary">{output.summary}</p>
        {output.highlights.length>0&&<><h3>{t("Что было важным")}</h3><ul>{output.highlights.map(point)}</ul></>}
        {output.themes.length>0&&<><h3>{t("Повторяющиеся темы")}</h3><ul>{output.themes.map(point)}</ul></>}
        {output.reflection_question&&<div className="review-question"><h3>{t("Вопрос для себя")}</h3><p>{output.reflection_question}</p></div>}
        <p className="review-note">{t("Обзор сохранён. При изменении или удалении записей он будет удалён — для новых данных можно создать новый.")}</p>
        <button type="button" className="button ghost" disabled={busy} onClick={()=>setDeleting(true)}><Trash2 size={15}/>{t("Удалить обзор")}</button>
      </div>:<div className="diary-review-action">
        {!permitted&&!preferencesLoading&&<div className="review-note">{t("Для обзора включите сообщения и доступ к модулям в настройках помощника.")} <button type="button" className="text-button" onClick={()=>setSettings(!settings)}>{t("Настройки доступа")}</button></div>}
        {settings&&<AssistantPreferences userId={user.id}/>}
        <label className="review-consent"><input type="checkbox" checked={consent} disabled={busy||inProgress} onChange={e=>setConsent(e.target.checked)}/>{t("Разрешаю отправить в OpenAI даты, заголовки и тексты моих записей за выбранные семь дней для подготовки обзора. Другие модули и история чата в этот запрос не входят.")}</label>
        <button type="button" className="button primary" disabled={busy||loading||preferencesLoading||!permitted||!consent||!data?.entry_count||inProgress} onClick={()=>void generate()}>{busy||inProgress?<LoaderCircle size={16} className="spinner"/>:<Sparkles size={16}/>} {busy||inProgress?t("Готовлю обзор…"):t("Создать обзор")}</button>
        <details className="review-help"><summary>{t("Как работает обзор")}</summary><p className="review-note">{t("Одна генерация использует один запрос из общего лимита ИИ. Повторное открытие готового обзора лимит не расходует. До 100 записей и 60 000 символов; записи не обрезаются. Ничего не публикуется и не добавляется в привычки автоматически.")}</p></details>
      </div>}
      {deleting&&data?.review&&<ConfirmDialog title={t("Удалить обзор?")} description={t("Будет удалён только обзор ИИ. Ваши записи дневника останутся.")} confirmLabel={t("Удалить обзор")} onClose={()=>setDeleting(false)} onConfirm={async()=>{await api(`/diary/weekly-review/${data.review!.id}`,{method:'DELETE'});await load();}}/>}
    </>}
  </section>;
}
