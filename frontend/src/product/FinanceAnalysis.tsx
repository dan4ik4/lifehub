import { t, locale, decimalSeparator } from '../lib/language';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw,Sparkles,Trash2,TrendingUp} from 'lucide-react';
import {api,errorMessage} from '../lib/api';
import {dayLabel,todayKey} from '../lib/dates';
import {useAssistantPreferences} from '../lib/assistantPreferences';
import {AssistantPreferences} from '../components/AssistantPreferences';
import {ConfirmDialog} from '../components/ui';
import type {User} from '../lib/types';
import './finance-analysis.css';

type Fact={id:string;text:string};
type Forecast={coverage_start:string;coverage_end:string;observed_days:number;observed_expense:string;daily_average:string;remaining_days:number;additional_expense:string;month_expense:string};
type Review={id:string;status:'processing'|'done'|'failed';updated_at:string;output:{fact_ids:string[];question:string}|null};
type Data={month:string;currency:string;cutoff:string|null;current:boolean;start_day:string;end_day:string;completed_days:number;transaction_count:number;income:string;expense:string;net_flow:string;categories:{category:string;label:string;amount:string;share:string}[];forecast:Forecast|null;forecast_reason:string|null;facts:Fact[];source_hash:string;review:Review|null};
const questions:Record<string,string>={check_coverage:t("Все ли операции за этот период уже внесены?"),review_categories:t("Какие из крупных категорий вы хотите рассмотреть подробнее?"),review_budget:t("Нужно ли уточнить бюджет с учётом внесённых расходов?"),check_recurring:t("Актуальны ли суммы и даты ваших подписок?")};

// Decimal strings may exceed JavaScript's exact integer range after summing many rows.
export function financeMoney(value:string){
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
  return (negative?'-':'')+BigInt(whole).toLocaleString(locale)+decimalSeparator+fraction.padEnd(2,'0');
}

export function FinanceAnalysis({user,month,currency,pro,revision}:{user:User;month:string;currency:string;pro:boolean;revision:unknown}){
  const today=todayKey(user.timezone),current=month===today.slice(0,7);
  const [start,setStart]=useState(month+'-01'),[complete,setComplete]=useState(false),[consent,setConsent]=useState(false);
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [settings,setSettings]=useState(false),[deleting,setDeleting]=useState(false);
  const {preferences,loading:preferencesLoading}=useAssistantPreferences(user.id);
  const serial=useRef(0),alive=useRef(true),generating=useRef(false);
  const coverage=complete&&current?start:null;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++;};},[]);
  const load=useCallback(async()=>{
    if(!pro)return;
    const number=++serial.current;setLoading(true);
    try{const result=await api<Data>(`/finance/analysis?month=${month}&currency=${currency}${coverage?'&coverage_start='+encodeURIComponent(coverage):''}`);if(alive.current&&number===serial.current){setData(result);setError('');}}
    catch(e){if(alive.current&&number===serial.current){setData(null);setError(errorMessage(e));}}
    finally{if(alive.current&&number===serial.current)setLoading(false);}
  },[month,currency,coverage,pro]);
  useEffect(()=>{setData(null);setError('');setConsent(false);void load();},[load,revision]);
  useEffect(()=>{const changed=()=>{setData(null);setConsent(false);void load();};window.addEventListener('lifehub:data-changed',changed);return()=>window.removeEventListener('lifehub:data-changed',changed);},[load]);
  useEffect(()=>{if(data?.review?.status!=='processing'||busy)return;const timer=window.setTimeout(()=>void load(),3000);return()=>window.clearTimeout(timer);},[data,busy,load]);
  async function generate(){
    if(!data||generating.current||!consent)return;generating.current=true;setBusy(true);setError('');const number=++serial.current;
    try{const result=await api<Data>('/finance/analysis',{method:'POST',body:{month,currency,coverage_start:coverage,source_hash:data.source_hash,consent:true}});if(alive.current&&number===serial.current){setData(result);setConsent(false);}}
    catch(e){if(alive.current&&number===serial.current)setError(errorMessage(e));}
    finally{generating.current=false;if(alive.current)setBusy(false);}
  }
  const permitted=preferences.messages&&preferences.modules;
  const output=data?.review?.output;
  const running=data?.review?.status==='processing'&&Date.now()-Date.parse(data.review.updated_at)<180000;
  return <section className="finance-analysis" aria-label={t("Аналитика финансов")}>
    <header><span className="analysis-icon"><TrendingUp size={22}/></span><div><h2>{t("Месяц в цифрах")}</h2><p>{t("Расходы по категориям и условный сценарий до конца месяца")}</p></div><button type="button" className="button secondary" disabled={!pro||busy||loading} onClick={()=>void load()}><RefreshCw size={15}/>{t("Обновить расчёты")}</button></header>
    {!pro?<p className="analysis-note">{t("Аналитика и разбор ИИ доступны с Pro или в пробном периоде.")}</p>:<>
      <p className="analysis-note">{t("Расчёт использует только завершённые дни: сегодняшние операции войдут завтра. Валюты считаются отдельно, разница доходов и расходов не равна остатку на счёте.")}</p>
      {error&&<p className="field-error" role="alert">{error}</p>}
      {loading&&!data&&<p role="status"><LoaderCircle size={16} className="spinner"/>{t("Считаю…")}</p>}
      {data&&<>
        <p className="analysis-note">{data.cutoff?t("С {0} по {1} · операций: {2}", dayLabel(data.start_day), dayLabel(data.cutoff), data.transaction_count):t("В этом месяце ещё нет завершённых дней.")}</p>
        <div className="analysis-metrics">{[[t("Доходы"),data.income],[t("Расходы"),data.expense],[t("Разница"),data.net_flow]].map(([label,value])=><div key={label}><small>{label}</small><strong>{financeMoney(value)} <span>{currency}</span></strong></div>)}</div>
        {data.categories.length>0&&<details className="analysis-details"><summary>{t("Расходы по категориям (")}{data.categories.length})</summary><ul>{data.categories.map(c=><li key={c.category}><span>{c.label}</span><strong>{financeMoney(c.amount)} {currency} · {c.share}%</strong></li>)}</ul></details>}
      </>}
      {current&&<div className="analysis-coverage"><h3>{t("Прогноз расходов")}</h3><label>{t("Начало полного учёта")}<input type="date" min={month+'-01'} max={data?.cutoff??today} value={start} disabled={busy} onChange={e=>{setStart(e.target.value);setComplete(false);}}/></label><label className="analysis-consent"><input type="checkbox" checked={complete} disabled={busy||!start||!data?.cutoff||start>data.cutoff} onChange={e=>setComplete(e.target.checked)}/>{t("Подтверждаю, что все операции с выбранной даты по вчерашний день внесены, включая дни без расходов.")}</label><p className="analysis-note">{t("Нужно не менее 7 полных дней учёта. Это сценарий при сохранении среднего темпа; разовые покупки могут заметно его менять. Будущие доходы не прогнозируются.")}</p></div>}
      {data?.forecast&&<div className="analysis-forecast"><span>{t("Если средний темп расходов сохранится")}</span><strong>≈ {financeMoney(data.forecast.month_expense)} {currency} {t("· внесённое + прогноз")}</strong><p>{t("Из них ещё ≈")} {financeMoney(data.forecast.additional_expense)} {currency} {t("за")} {data.forecast.remaining_days} {t("дней.")}</p><p className="analysis-note">{t("Основа:")} {financeMoney(data.forecast.observed_expense)} {currency} ÷ {data.forecast.observed_days} {t("дней ×")} {data.forecast.remaining_days} {t("оставшихся дней + внесённые расходы месяца. Округление до копеек — после расчёта.")}</p>{data.forecast.coverage_start>data.start_day&&<p className="analysis-note">{t("Полнота учёта до")} {dayLabel(data.forecast.coverage_start)} {t("не подтверждена. Расходы за пропущенные дни не восстанавливаются.")}</p>}</div>}
      {data?.forecast_reason==='too_few_days'&&<p className="analysis-note">{t("Для прогноза пока меньше 7 завершённых дней с подтверждённым полным учётом.")}</p>}
      {data?.forecast_reason==='no_expenses'&&<p className="analysis-note">{t("В подтверждённом периоде нет расходов. Прогноз нулевых расходов не строится.")}</p>}
      {data&&<details className="analysis-details"><summary>{t("Все расчёты и основания")}</summary><ul>{data.facts.map(f=><li key={f.id}>{f.text}</li>)}</ul></details>}
      <div className="analysis-ai"><h3><Sparkles size={17}/>{t("Главное с ИИ")}</h3><p className="analysis-note">{t("ИИ выбирает важные пункты из проверенных расчётов. Все цифры и формулировки пунктов сформированы Life Hub.")}</p>
        {output?<><ol>{output.fact_ids.map(id=><li key={id}>{data?.facts.find(f=>f.id===id)?.text}</li>)}</ol>{questions[output.question]&&<p className="analysis-question">{questions[output.question]}</p>}<button type="button" className="button ghost" disabled={busy} onClick={()=>setDeleting(true)}><Trash2 size={15}/>{t("Удалить разбор")}</button></>:<>
          {!permitted&&!preferencesLoading&&<p className="analysis-note">{t("Включите сообщения и доступ к модулям.")} <button type="button" className="text-button" onClick={()=>setSettings(!settings)}>{t("Настройки доступа")}</button></p>}
          {settings&&<AssistantPreferences userId={user.id}/>}
          {data?.review?.status==='failed'&&<p className="analysis-note">{t("Предыдущая попытка не завершилась. Можно повторить разбор.")}</p>}
          <label className="analysis-consent"><input type="checkbox" checked={consent} disabled={busy||running} onChange={e=>setConsent(e.target.checked)}/>{t("Разрешаю отправить в OpenAI итоги выбранного месяца: суммы, категории, бюджеты, число и сумму предстоящих подписок, условия прогноза. Названия операций, заметки, счета, исходные файлы и другие модули не передаются.")}</label>
          <button type="button" className="button primary" disabled={busy||loading||running||preferencesLoading||!permitted||!consent||!data?.transaction_count} onClick={()=>void generate()}>{busy||running?<LoaderCircle size={16} className="spinner"/>:<Sparkles size={16}/>} {busy||running?t("Выделяю главное…"):t("Разобрать месяц с ИИ")}</button>
          <details className="review-help"><summary>{t("Как работает обзор")}</summary><p className="analysis-note">{t("Расчёты не расходуют лимит ИИ. Одна генерация — один запрос; готовый разбор открывается повторно без нового запроса. Изменение операций, бюджетов или подписок сбрасывает разбор. Ничего не оплачивается и не меняется автоматически.")}</p></details>
        </>}
      </div>
      {deleting&&data?.review&&<ConfirmDialog title={t("Удалить разбор?")} description={t("Удалится только подборка ИИ. Операции, бюджеты и подписки останутся.")} confirmLabel={t("Удалить разбор")} onClose={()=>setDeleting(false)} onConfirm={async()=>{await api(`/finance/analysis/${data.review!.id}`,{method:'DELETE'});await load();}}/>}
    </>}
  </section>;
}
