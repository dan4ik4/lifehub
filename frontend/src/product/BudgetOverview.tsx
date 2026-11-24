import {currencyCodes} from "./schema";
import { t } from '../lib/language';
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {LifeCard,LifeLink,LifeRings} from '../components/LifeCard';
import {api,errorMessage} from '../lib/api';
import {dayLabel,shiftMonth} from '../lib/dates';
import type {Notify} from '../lib/types';
import {formatAmount} from './format';
import type {Row} from './schema';

const short={food:t("Еда"),transport:t("Транспорт"),home:t("Дом"),health:t("Здоровье"),leisure:t("Досуг"),other:t("Другое")};
export function BudgetOverview({month,currency,revision,notify,navigate,onRefresh}:{month:string;currency:string;revision:unknown;notify:Notify;navigate:(path:string)=>void;onRefresh:()=>void}){
  const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const selection=new URLSearchParams({month,currency});
  function select(nextMonth:string,nextCurrency:string){navigate('/modules/finance/budgets?'+new URLSearchParams({month:nextMonth,currency:nextCurrency}));}
  useEffect(()=>{
    const c=new AbortController();setError('');setLoading(true);
    api<{budgets:Row[]}>('/finance/overview?'+new URLSearchParams({month,currency}),{signal:c.signal}).then(result=>{
      if(!c.signal.aborted)setRows(result.budgets??[]);
    }).catch(cause=>{if(!c.signal.aborted)setError(errorMessage(cause));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return ()=>c.abort();
  },[month,currency,revision]);
  async function copy(){
    setBusy(true);setError('');
    try{
      const data=await api<{copied:number}>('/finance/budgets/copy',{method:'POST',body:{month,currency}});
      notify(data.copied?t("Скопировано лимитов: ")+data.copied:t("Новых лимитов для копирования нет"));
      onRefresh();
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  }
  return <section className="life-budget-overview" aria-label={t("Лимиты за месяц")}>
    <header>
      <button className="icon-button" aria-label={t("Предыдущий месяц")} onClick={()=>select(shiftMonth(month+'-01',-1).slice(0,7),currency)}>‹</button>
      <strong>{dayLabel(month+'-01',{month:'long',year:'numeric'})}</strong>
      <button className="icon-button" aria-label={t("Следующий месяц")} onClick={()=>select(shiftMonth(month+'-01',1).slice(0,7),currency)}>›</button>
      <label>{t("Валюта")} <select value={currency} onChange={e=>select(month,e.target.value)}>{currencyCodes(currency).map(code=><option key={code}>{code}</option>)}</select></label>
      <button className="button secondary" disabled={busy||loading} onClick={()=>void copy()}><RefreshCw size={15}/>{t("Как в прошлом месяце")}</button>
    </header>
    {error&&<p className="field-error" role="alert">{error}</p>}
    {loading?<p role="status">{t("Загружаю лимиты…")}</p>:rows.length?<div className="life-budget-tiles">{rows.map(row=>{
      const value=Number(row.percent),category=String(row.category),title=short[category as keyof typeof short]??category;
      return <LifeCard key={row.id}><h3>{title}</h3><div><LifeRings size={62} label={value+t("% лимита")} values={[{value:value/100,color:value>100?'#b74832':value>=80?'#89600e':'#245447'}]}/>
        <span><strong>{formatAmount(row.spent)}</strong> / {formatAmount(row.amount)} {currency}<small>{Number(row.remaining)<0?t("Сверх лимита ")+formatAmount(-Number(row.remaining)):t("Осталось ")+formatAmount(row.remaining)} {currency}</small></span></div>
        <LifeLink action={()=>{const query=new URLSearchParams(selection);query.set('category',category);query.set('kind','expense');navigate('/modules/finance/transactions?'+query);}}>{t("Операции")}</LifeLink></LifeCard>;})}</div>:<p>{t("На выбранный месяц лимитов пока нет.")}</p>}
  </section>;
}
