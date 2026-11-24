import {currencyCodes} from "./schema";
import { t } from '../lib/language';
import {OverviewWidgets,WidgetGroup} from '../components/OverviewWidgets';
import {LifeCard,LifeLink} from '../components/LifeCard';
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Check, Clock3, LoaderCircle, RefreshCw, Wallet } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { todayKey, shiftDay } from "../lib/dates";
import type { User, Notify } from "../lib/types";
import type { Row, Section } from "./schema";
import { Modal } from "../components/ui";
import { GoalLinks, MilestoneEditor } from "./Extras";
import { isPro, text, amount, dateLabel, Progress } from "./recordPresentation";
import { FinanceAnalysis } from "./FinanceAnalysis";
import {displayWeight, weightLabel} from './weight';
const categoryLabels:Record<string,string>={food:t("Еда"),transport:t("Транспорт"),home:t("Дом"),health:t("Здоровье"),leisure:t("Досуг"),other:t("Другое"),income:t("Доход")};
type FinanceSnapshot = {
  income:string; expense:string; balance:string; net_worth?:string;
  categories:{category:string;amount:string}[];
  budgets?:Row[];
};
export function FinanceOverview({user,revision,preferences,onSelect,onCategory,analysis=false,home=false,goto}: {
  user:User;
  revision:unknown;
  preferences:URLSearchParams;
  onSelect:(params:URLSearchParams)=>void;
  onCategory:(params:URLSearchParams)=>void;
  analysis?:boolean;home?:boolean;goto?:(path:string)=>void;
}) {
  const currency = /^[A-Z]{3}$/.test(preferences.get('currency')??'') ? preferences.get('currency')! : 'PLN';
  const month = /^[1-8]\d{3}-(0[1-9]|1[0-2])$/.test(preferences.get('month')??'') ? preferences.get('month')! : todayKey(user.timezone).slice(0,7);
  const [data,setData] = useState<FinanceSnapshot|null>(null);
  const [error,setError] = useState('');
  const [upcoming,setUpcoming]=useState<Row[]|null>(null);
  const [paymentError,setPaymentError]=useState("");
  const [reload,setReload] = useState(0);
  useEffect(() => {
    if (analysis) return;
    const controller = new AbortController();
    setData(null);
    setError('');
    api<FinanceSnapshot>(`/finance/overview?month=${month}&currency=${currency}`,{signal:controller.signal}).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    });
    return () => controller.abort();
  }, [month,currency,revision,reload,user.id,analysis]);
  const pro=isPro(user), today=todayKey(user.timezone);
  useEffect(()=>{
    if(!home||!pro)return;
    const controller=new AbortController();
    setPaymentError('');
    setUpcoming(null);
    async function loadPayments() {
      const subscriptions: Row[] = [];
      for (let offset=0; ; offset+=100) {
        const page = await api<{items:Row[];has_more:boolean}>('/finance/subscriptions?limit=100&offset='+offset,{signal:controller.signal});
        subscriptions.push(...page.items);
        if (!page.has_more) break;
      }
      if(!controller.signal.aborted)setUpcoming(subscriptions.filter(row=>row.currency===currency&&row.active!==false&&String(row.next_due??row.next_payment)>=today)
        .sort((a,b)=>String(a.next_due??a.next_payment).localeCompare(String(b.next_due??b.next_payment))).slice(0,4));
    }
    void loadPayments().catch(cause=>{if(!controller.signal.aborted)setPaymentError(errorMessage(cause));});
    return ()=>controller.abort();
  },[home,pro,today,currency,revision,reload]);
  const select = (name:string,value:string) => {
    const next = new URLSearchParams({month,currency});
    next.set(name,value);
    onSelect(next);
  };
  const categories = [...(data?.categories??[])].sort((a,b) => Number(b.amount)-Number(a.amount));
  const largest = Number(categories[0]?.amount??1);
  const displayCurrency=currency==='PLN'?'zł':currency;
  return <section className={'finance-overview'+(home?' life-finance-overview':'')} aria-label={t("Сводка финансов")}>
    <div className="overview-controls">
      {!home && <label>{t("Месяц")} <input type="month" value={month} max={analysis?todayKey(user.timezone).slice(0,7):undefined}
        onChange={event => {if (event.target.value) select('month',event.target.value);}}/></label>}
      <label>{t("Валюта")} <select value={currency} onChange={event => select('currency',event.target.value)}>
        {currencyCodes(currency).map(code => <option key={code}>{code}</option>)}
      </select></label>
    </div>
    {analysis ? <FinanceAnalysis key={month+':'+currency} user={user} month={month} currency={currency} pro={pro} revision={revision}/>
      : error ? <p className="product-error" role="alert">{error}<button className="text-button" onClick={() => setReload(value=>value+1)}>{t("Повторить")}</button></p>
      : !data ? <p className="product-loading" role="status">{t("Загружаем сводку…")}</p>
      : <>
        {home?<OverviewWidgets account={user.id} page="finance" groups={[
          {id:'totals',title:t("Показатели"),widgets:{balance:t("Разница доходов и расходов"),income:t("Доходы"),expense:t("Расходы")}},
          {id:'panels',title:t("Подробный обзор"),widgets:pro?
            {categories:t("Куда ушли деньги"),upcoming:t("Ближайшие платежи"),forecast:t("Прогноз до конца месяца")}:
            {categories:t("Куда ушли деньги")}},
        ]}><div className="life-finance-totals"><WidgetGroup name="totals">
          <LifeCard key="balance" className="life-finance-balance"><small>{t("Разница доходов и расходов")}</small><strong>{Number(data.balance)>0?'+':''}{amount(data.balance)} <span>{displayCurrency}</span></strong>
          </LifeCard>
          <LifeCard key="income" className="life-finance-number"><h3>{t("Доходы")}</h3><strong>{amount(data.income)} <small>{displayCurrency}</small></strong></LifeCard>
          <LifeCard key="expense" className="life-finance-number"><h3>{t("Расходы")}</h3><strong>{amount(data.expense)} <small>{displayCurrency}</small></strong></LifeCard>
        </WidgetGroup></div><div className="life-finance-panels overview-widget-panels"><WidgetGroup name="panels">
          <LifeCard key="categories" className="life-finance-categories"><header className="life-card-head"><div><h3>{t("Куда ушли деньги")}</h3></div>
            {pro&&<LifeLink action={()=>goto?.('/modules/finance/budgets?'+new URLSearchParams({month,currency}))}>{t("Бюджеты")}</LifeLink>}</header>
            {categories.length>0?<><div className="life-spend-stack" aria-hidden="true">{categories.map(({category,amount},index)=><i key={category} style={{flex:Number(amount),background:['#89600e','#484f94','#895934','#245447','#b59347'][index%5]}}/>)}</div>
              <div className="hub-categories">{categories.map(({category,amount:total},index)=>{
                const budget=data.budgets?.find(row=>row.category===category);
                const max=budget?Number(budget.amount):largest,pct=max?100*Number(total)/max:0;
                return <button key={category} onClick={()=>onCategory(new URLSearchParams({month,currency,category,kind:'expense'}))}>
                  <span>{categoryLabels[category]??category}</span><strong>{amount(total)} {displayCurrency}{budget?<small> / {amount(budget.amount)}</small>:null}</strong>
                  <span className="hub-category-bar"><i style={{width:Math.min(100,pct)+'%',background:pct>100?'#b74832':['#89600e','#484f94','#895934','#245447'][index%4]}}/></span>
                </button>;
              })}</div></>:<p>{t("Расходы за этот месяц пока не записаны.")}</p>}
          </LifeCard>
          {pro&&<LifeCard key="upcoming"><header className="life-card-head"><h3>{t("Ближайшие платежи")}</h3><LifeLink action={()=>goto?.('/modules/finance/subscriptions')}>{t("Подписки")}</LifeLink></header>
            {paymentError?<p role="alert">{paymentError} <button className="text-button" onClick={()=>setReload(value=>value+1)}>{t("Повторить")}</button></p>:upcoming===null?<p role="status">{t("Загрузка…")}</p>:upcoming.length?upcoming.map(row=><button className="life-payment" key={row.id} onClick={()=>goto?.('/modules/finance/subscriptions/'+row.id)}><i>{String(row.title).slice(0,1)}</i><span>{String(row.title)}<small>{dateLabel(row.next_due??row.next_payment)}</small></span><strong>{amount(row.amount)} {displayCurrency}</strong></button>):<p>{t("Ближайших платежей пока нет.")}</p>}</LifeCard>}
          {pro&&<LifeCard key="forecast"><h3>{t("Прогноз до конца месяца")}</h3><p>{t("Откройте аналитику и укажите период полного учёта.")}</p><LifeLink action={()=>goto?.('/modules/finance/analysis?'+new URLSearchParams({month,currency}))}>{t("Открыть аналитику")}</LifeLink></LifeCard>}
        </WidgetGroup></div></OverviewWidgets>:<>        <div className="finance-totals">
          {([['expense',t("Расходы")],['income',t("Доходы")],['balance',t("Разница")]] as const).map(([key,label]) => <div key={key}>
            <small>{label}</small><strong>{amount(data[key])} <span>{currency}</span></strong>
          </div>)}
        </div>
        {!!categories.length && <div className="hub-categories">
          <h3>{t("Расходы по категориям")}</h3>
          {categories.map(({category,amount:total}) => <button key={category}
            aria-pressed={!analysis ? preferences.get('category')===category : undefined}
            onClick={() => onCategory(new URLSearchParams({month,currency,category,kind:'expense'}))}>
            <span>{categoryLabels[category]??category}</span>
            <span className="hub-category-bar"><i style={{width: Math.min(100,Number(total)/largest*100)+'%'}}/></span>
            <strong>{amount(total)} {currency}</strong><ArrowRight size={15}/>
          </button>)}
        </div>}
        {!!data.budgets?.length && <details className="hub-disclosure"><summary>{t("Использование бюджетов")}</summary>
          <div className="budget-bars">{data.budgets.map(b => <button key={b.id} className="hub-budget-link"
            onClick={() => onCategory(new URLSearchParams({month,currency,category:text(b.category),kind:'expense'}))}>
            <Progress value={Number(b.percent)} label={categoryLabels[text(b.category)]??text(b.category)}/>
            <small>{amount(b.spent)} / {amount(b.amount)} {currency}</small>
          </button>)}</div>
        </details>}
</>}
      </>}
  </section>;
}
export function RecordDetail({
  section: s,
  initial,
  user,
  onClose,
  onEdit,
  notify,
}: {
  section: Section;
  initial: Row;
  user: User;
  onClose: () => void;
  onEdit?: () => void;
  notify: Notify;
}) {
  const [item, setItem] = useState(initial),
    [payload, setPayload] = useState<Record<string, unknown>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [historyDays,setHistoryDays]=useState(30);
  const day = todayKey(user.timezone),
    [selected, setSelected] = useState(day),
    [value, setValue] = useState(""),
    [title, setTitle] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      let path = "";
      if (s.key === "goals") path = "/goals/" + initial.id;
      if (s.key === "habits")
        path = `/habits/${initial.id}/checkins?from=${shiftDay(day, -historyDays+1)}&to=${day}`;
      if (s.key === "medications")
        path = `/health/medications/${initial.id}/intakes?day=${selected}`;
      if (s.key === "savings") path = `/finance/savings/${initial.id}/history`;
      if (s.key === "debts") path = `/finance/debts/${initial.id}/payments`;
      if (path) setPayload(await api<Record<string, unknown>>(path));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [s.key, initial.id, day, selected, historyDays]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function act(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Row>(path, { method: "POST", body });
      if (s.key === "habits" || s.key === "medications") setItem(next);
      if (s.key === "debts") setItem(next.debt as Row);
      setValue("");
      setTitle("");
      await refresh();
      notify(t("Сохранено"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const checkins = (payload.items as Row[]) || [];
  return (
    <Modal
      title={text(item.title) || s.singular}
      onClose={() => !busy && onClose()}
      className="product-modal hub-detail-modal"
    >
      <div className="modal-body detail-body">
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!['diary','habits','goals','medications','savings','debts'].includes(s.key) && <dl className="hub-entry-facts">
          {s.fields.filter(field => field.key!=='title' && item[field.key]!==null && item[field.key]!==undefined && item[field.key]!=='' && !Array.isArray(item[field.key])).map(field => {
            const raw = item[field.key];
            const value = field.key==='kg' ? amount(displayWeight(raw,user.weight_unit))+' '+weightLabel(user.weight_unit)
              : field.type==='date' || field.type==='datetime-local' ? dateLabel(raw)
              : field.options?.find(option => option[0]===text(raw))?.[1] ?? text(raw);
            return <div key={field.key}><dt>{field.key==='kg'?t("Вес"):field.label}</dt><dd>{value}</dd></div>;
          })}
          {s.key==='programs' && <div><dt>{t("Упражнения")}</dt><dd>{Array.isArray(item.exercises) ? item.exercises.map((exercise,index) => {
            const row = exercise as Record<string,unknown>;
            return <p key={index}>{text(row.name)}{row.sets ? ' · '+text(row.sets)+t(" подходов") : ''}{row.reps ? ' × '+text(row.reps) : ''}</p>;
          }) : '—'}</dd></div>}
          {s.key==='workouts'&&Array.isArray(item.efforts)&&item.efforts.length>0&&<div><dt>{t("Выполненные подходы")}</dt>
            <dd><ul className="life-efforts">{item.efforts.map((effort,index)=><li key={index}>
              <strong>{text(effort.name)}</strong><span>{text(effort.reps)}{effort.kg!=null?' × '+amount(effort.kg)+t(" кг"):t(" повторов")}</span>
            </li>)}</ul></dd></div>}
        </dl>}
        {s.key === "diary" && (
          <>
            <span className="eyebrow">{dateLabel(item.day)}</span>
            {item.mood!=null&&<p>{t("Настроение ·")} {text(item.mood)} {t("из 5")}</p>}
            <p className="diary-full">{text(item.text)}</p>
            {Array.isArray(item.tags)&&item.tags.length>0&&<div className="life-diary-tags">{item.tags.map((tag,index)=><span className="life-tag" key={index}>{text(tag)}</span>)}</div>}
          </>
        )}
        {s.key === "habits" && (
          <>
            <Progress
              value={Number(payload.completion_percent || 0)}
              label={t("Выполнение за {0} дней", historyDays)}
            />
            {isPro(user)&&<label className="product-field">{t("Период истории")}<select value={historyDays} onChange={e=>setHistoryDays(Number(e.target.value))}><option value={30}>{t("30 дней")}</option><option value={90}>{t("90 дней")}</option><option value={365}>{t("Год")}</option></select></label>}
          <div className="habit-heatmap" aria-label={t("История за {0} дней", historyDays)}>
              {Array.from({ length: historyDays }, (_, i) => shiftDay(day, i - historyDays+1)).map(
                (d) => {
                  const done = checkins.find((c) => c.day === d);
                  return (
                    <button
                      key={d}
                      title={`${dateLabel(d)}: ${done ? amount(done.value) : t("нет отметки")}`}
                      className={
                        Number(done?.value) >= Number(item.target) ? "done" : ""
                      }
                      aria-pressed={selected === d}
                      onClick={() => {
                        setSelected(d);
                        setValue(text(done?.value ?? 0));
                      }}
                    >
                      {d.slice(-2)}
                    </button>
                  );
                },
              )}
            </div>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(`/habits/${item.id}/checkins`, {
                  day: selected,
                  value,
                  version: item.version,
                });
              }}
            >
              <label>
                {t("Дата")}
                <input
                  type="date"
                  required
                  max={day}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                />
              </label>
              <label>
                {t("Результат")}
                <input
                  type="number"
                  required
                  min={0}
                  max={item.kind === "boolean" ? 1 : undefined}
                  step={item.kind === "boolean" ? 1 : ".0001"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                {t("Сохранить")}
              </button>
            </form>
          </>
        )}
        {s.key === "medications" && (
          <>
            <p>{text(item.dosage)}</p>
            <label className="product-field">
              {t("Дата")}
              <input
                type="date"
                value={selected}
                max={day}
                onChange={(e) => setSelected(e.target.value)}
              />
            </label>
            {(item.times as string[]).map((time) => {
              const taken = checkins.some((i) => i.time === time);
              return (
                <button
                  key={time}
                  className={`intake-row ${taken ? "done" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    void act(`/health/medications/${item.id}/intakes`, {
                      day: selected,
                      time,
                      taken: !taken,
                      version: item.version,
                    })
                  }
                >
                  <span>{time}</span>
                  <span>
                    {taken ? t("Принято") : t("Отметить приём")}
                    {taken && <Check size={17} />}
                  </span>
                </button>
              );
            })}
          </>
        )}
        {s.key === "savings" && (
          <>
            {checkins.map((r) => (
              <div className="intake-row" key={r.id}>
                <span>{dateLabel(r.created_at)}</span>
                <strong>
                  {amount(r.amount)} {text(r.currency)}
                </strong>
              </div>
            ))}
          </>
        )}
        {s.key === "savings" && !!payload.has_more && <button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const next=await api<{items:Row[];has_more:boolean}>(`/finance/savings/${item.id}/history?offset=${checkins.length}`);setPayload(old=>({...old,items:[...checkins,...next.items],has_more:next.has_more}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>{t("Показать ещё")}</button>}
      {s.key === "debts" && (
          <>
            <p className="record-metric">
              {t("Осталось")} {amount(payload.remaining)} {text(item.currency)}
            </p>
            {checkins.map((p) => (
              <div className="intake-row" key={p.id}>
                <span>{dateLabel(p.day)}</span>
                <strong>
                  −{amount(p.amount)} {text(item.currency)}
                </strong>
              </div>
            ))}
            {item.status === "active" && (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(`/finance/debts/${item.id}/payments`, {
                    day: selected,
                    amount: value,
                    version: item.version,
                  });
                }}
              >
                <label>
                  {t("Дата")}
                  <input
                    type="date"
                    required
                    max={day}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  />
                </label>
                <label>
                  {t("Сумма")}
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    max={Number(payload.remaining)}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  {t("Погасить часть")}
                </button>
              </form>
            )}
          </>
        )}
        {s.key === "goals" && (
          <>
            <p className="diary-full">{text(item.description)}</p>
            <Progress value={Number(item.progress)} label={t("Прогресс")} />
            {isPro(user) ? (
              <>
                <GoalLinks
                  goalId={item.id}
                  payload={payload}
                  onRefresh={refresh}
                />
                <h3>{t("Этапы")}</h3>
                {((payload.milestones as Row[]) || []).map((m) => (
                  <MilestoneEditor
                    key={m.id + ":" + m.version}
                    goalId={item.id}
                    item={m}
                    onRefresh={refresh}
                  />
                ))}
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(`/goals/${item.id}/milestones`, {
                      title,
                      progress: 0,
                    });
                  }}
                >
                  <label>
                    {t("Новый этап")}
                    <input
                      required
                      maxLength={300}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    {t("Добавить")}
                  </button>
                </form>
              </>
            ) : (
              <p className="muted">{t("Этапы и связи с задачами доступны в Pro.")}</p>
            )}
          </>
        )}
      </div>
      {onEdit && <footer className="modal-footer"><button type="button" className="button primary" disabled={busy} onClick={onEdit}>{t("Изменить запись")}</button></footer>}
    </Modal>
  );
}
