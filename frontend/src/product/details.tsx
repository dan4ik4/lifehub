import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { todayKey, shiftDay } from "../lib/dates";
import type { User, Notify } from "../lib/types";
import type { Row, Section } from "./schema";
import { Modal } from "../components/ui";
import { GoalLinks, MilestoneEditor } from "./Extras";
import { isPro, text, amount, dateLabel, Progress } from "./Product";
import { FinanceAnalysis } from "./FinanceAnalysis";
export function FinanceOverview({
  user,
  revision,
}: {
  user: User;
  revision: Row[];
}) {
  const [currency, setCurrency] = useState("PLN"),
    [month, setMonth] = useState(todayKey(user.timezone).slice(0, 7)),
    [data, setData] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    api<Record<string, unknown>>(
      `/finance/overview?month=${month}&currency=${currency}`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [currency, month, revision]);
  return (
    <div className="finance-overview">
      <div className="overview-controls">
        <label>
          Месяц
          <input
            type="month"
            value={month}
            required
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
        <label>
          Валюта
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["PLN", "EUR", "USD", "RUB", "UAH", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        data && (
          <>
            <div className="finance-totals">
              {[
                ["income", "Доходы"],
                ["expense", "Расходы"],
                ["balance", "Разница за месяц"],
              ].map(([key, label]) => (
                <div key={key}>
                  <small>{label}</small>
                  <strong>
                    {amount(data[key])} <span>{currency}</span>
                  </strong>
                </div>
              ))}
            </div>
            {data.net_worth!==undefined&&<p className="muted">Накопления с учётом долгов: <strong>{amount(data.net_worth)} {currency}</strong></p>}
            {Array.isArray(data.budgets) && data.budgets.length > 0 && (
              <div className="budget-bars">
                {(data.budgets as Row[]).map((b) => (
                  <div
                    key={b.id}
                    className={
                      Number(b.percent) > 100
                        ? "over"
                        : Number(b.percent) > 80
                          ? "near"
                          : ""
                    }
                  >
                    <Progress
                      value={Number(b.percent)}
                      label={text(b.category)}
                    />
                    <small>
                      {amount(b.spent)} / {amount(b.amount)} {currency}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      )}
      <FinanceAnalysis key={month+currency} user={user} month={month} currency={currency} pro={isPro(user)} revision={revision}/>
    </div>
  );
}
export function RecordDetail({
  section: s,
  initial,
  user,
  onClose,
  notify,
}: {
  section: Section;
  initial: Row;
  user: User;
  onClose: () => void;
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
      notify("Сохранено");
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
      className="product-modal"
    >
      <div className="modal-body detail-body">
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {s.key === "diary" && (
          <>
            <span className="eyebrow">{dateLabel(item.day)}</span>
            <p className="diary-full">{text(item.text)}</p>
          </>
        )}
        {s.key === "habits" && (
          <>
            <Progress
              value={Number(payload.completion_percent || 0)}
              label={`Выполнение за ${historyDays} дней`}
            />
            {isPro(user)&&<label className="product-field">Период истории<select value={historyDays} onChange={e=>setHistoryDays(Number(e.target.value))}><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={365}>Год</option></select></label>}
          <div className="habit-heatmap" aria-label={`История за ${historyDays} дней`}>
              {Array.from({ length: historyDays }, (_, i) => shiftDay(day, i - historyDays+1)).map(
                (d) => {
                  const done = checkins.find((c) => c.day === d);
                  return (
                    <button
                      key={d}
                      title={`${dateLabel(d)}: ${done ? amount(done.value) : "нет отметки"}`}
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
                Дата
                <input
                  type="date"
                  required
                  max={day}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                />
              </label>
              <label>
                Результат
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
                Сохранить
              </button>
            </form>
          </>
        )}
        {s.key === "medications" && (
          <>
            <p>{text(item.dosage)}</p>
            <label className="product-field">
              Дата
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
                    {taken ? "Принято" : "Отметить приём"}
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
        {s.key === "savings" && !!payload.has_more && <button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const next=await api<{items:Row[];has_more:boolean}>(`/finance/savings/${item.id}/history?offset=${checkins.length}`);setPayload(old=>({...old,items:[...checkins,...next.items],has_more:next.has_more}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>Показать ещё</button>}
      {s.key === "debts" && (
          <>
            <p className="record-metric">
              Осталось {amount(payload.remaining)} {text(item.currency)}
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
                  Дата
                  <input
                    type="date"
                    required
                    max={day}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  />
                </label>
                <label>
                  Сумма
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
                  Погасить часть
                </button>
              </form>
            )}
          </>
        )}
        {s.key === "goals" && (
          <>
            <p className="diary-full">{text(item.description)}</p>
            <Progress value={Number(item.progress)} label="Прогресс" />
            {isPro(user) ? (
              <>
                <GoalLinks
                  goalId={item.id}
                  payload={payload}
                  onRefresh={refresh}
                />
                <h3>Этапы</h3>
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
                    Новый этап
                    <input
                      required
                      maxLength={300}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    Добавить
                  </button>
                </form>
              </>
            ) : (
              <p className="muted">Этапы и связи с задачами доступны в Pro.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
