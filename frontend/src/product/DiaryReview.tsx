import { t } from '../lib/language';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw,Sparkles,Trash2} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel} from '../lib/dates';
import {ConfirmDialog} from '../components/ui';
import './diary-review.css';

type Point={text:string;entry_ids:string[]};
type Output={summary:string;highlights:Point[];themes:Point[];reflection_question:string};
type Review={id:string;status:'processing'|'done'|'failed';output:Output|null;updated_at:string};
type Data={start_day:string;end_day:string;entry_count:number;recorded_days:string[];sources:{id:string;day:string;title:string}[];review:Review|null};

export function DiaryReview({pro,revision,onSource,endDay,resultsConsent,onConsent}:{pro:boolean;revision:unknown;onSource:(day:string)=>void;endDay:string;resultsConsent:boolean;onConsent:()=>void}){
  const end=endDay;
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const alive=useRef(true),requestNumber=useRef(0),generation=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;requestNumber.current++;};},[]);
  const load=useCallback(async()=>{
    if(!pro||!end)return;
    const number=++requestNumber.current;setLoading(true);
    try{const value=await api<Data>('/diary/weekly-review?end_day='+encodeURIComponent(end));if(alive.current&&number===requestNumber.current){setData(value);setError('');}}
    catch(e){if(alive.current&&number===requestNumber.current){setData(null);setError(errorMessage(e));}}
    finally{if(alive.current&&number===requestNumber.current)setLoading(false);}
  },[end,pro]);
  useEffect(()=>{setData(null);setError('');void load();},[load,revision]);
  useEffect(()=>{
    if(data?.review?.status!=='processing'||busy)return;
    const timer=window.setTimeout(()=>void load(),3000);return()=>window.clearTimeout(timer);
  },[data,busy,load]);
  async function generate(){
    if(generation.current||!end||!resultsConsent)return;generation.current=true;setBusy(true);setError('');const number=++requestNumber.current;
    try{const value=await api<Data>('/diary/weekly-review',{method:'POST',body:{end_day:end,consent:true,from_results:true}});if(alive.current&&number===requestNumber.current)setData(value);}
    catch(e){if(alive.current&&number===requestNumber.current)setError(errorMessage(e));}
    finally{generation.current=false;if(alive.current)setBusy(false);}
  }
  const output=data?.review?.output;
  const inProgress=data?.review?.status==='processing'&&Date.now()-Date.parse(data.review.updated_at)<180000;
  const source=(id:string)=>data?.sources.find(s=>s.id===id);
  const point=(p:Point,index:number)=><li key={index}><p>{p.text}</p><div className="review-sources">{[...new Set(p.entry_ids)].map(id=>{const entry=source(id);return entry?<button key={id} type="button" onClick={()=>onSource(entry.day)} title={entry.title||t("Запись дневника")}>{dayLabel(entry.day,{day:'numeric',month:'short'})}{entry.title?' · '+entry.title:''}</button>:null;})}</div></li>;
  return <section className="diary-review" aria-label={t("Недельный обзор дневника")}>
    <header><span className="review-icon"><Sparkles size={21}/></span><div><h2>{t("Обзор семи дней")}</h2><p>{t("События и темы из ваших записей")}</p></div></header>
    {!pro?<p className="review-note">{t("Недельный обзор доступен с Pro или в пробном периоде.")}</p>:<>
      <div className="review-controls"><button type="button" className="button secondary" disabled={busy||loading||!end} onClick={()=>void load()}><RefreshCw size={15}/>{t("Обновить")}</button></div>
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
        {!resultsConsent&&<button type="button" className="button secondary" onClick={onConsent}>{t("Что передаётся")}</button>}
        <button type="button" className="button primary" disabled={busy||loading||!resultsConsent||!data?.entry_count||inProgress} onClick={()=>void generate()}>{busy||inProgress?<LoaderCircle size={16} className="spinner"/>:<Sparkles size={16}/>} {busy||inProgress?t("Готовлю обзор…"):t("Создать обзор")}</button>
        <details className="review-help"><summary>{t("Как работает обзор")}</summary><p className="review-note">{t("Одна генерация использует один запрос из общего лимита ИИ. Повторное открытие готового обзора лимит не расходует. До 100 записей и 60 000 символов; записи не обрезаются. Ничего не публикуется и не добавляется в привычки автоматически.")}</p></details>
      </div>}
      {deleting&&data?.review&&<ConfirmDialog title={t("Удалить обзор?")} description={t("Будет удалён только обзор ИИ. Ваши записи дневника останутся.")} confirmLabel={t("Удалить обзор")} onClose={()=>setDeleting(false)} onConfirm={async()=>{await api(`/diary/weekly-review/${data.review!.id}`,{method:'DELETE'});await load();}}/>}
    </>}
  </section>;
}
