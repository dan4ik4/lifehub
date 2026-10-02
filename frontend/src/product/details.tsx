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
                ["balance", "Остаток за месяц"],
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

type DashboardData = {
  day: string;
  modules: string[];
  widgets: {
    habits?: Row[];
    sleep?: Row | null;
    books?: Row[];
    finance?: Row[];
    budgets?: Row[];
    planning?: {
      tasks: {
        task: { id: string; title: string; version: number };
        occurrence: { status: string; occurrence_at: string | null };
      }[];
      events: { id: string; title: string; start_at: string }[];
    };
  };
};
export function Dashboard({
  user,
  navigate,
  notify,
}: {
  user: User;
  navigate: (p: string) => void;
  notify: Notify;
}) {
  const [data, setData] = useState<DashboardData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [acting, setActing] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await api<DashboardData>("/dashboard"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  async function toggle(path: string, body: unknown, id: string) {
    if (acting) return;
    setActing(id);
    try {
      await api(path, { method: "POST", body });
      await refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
      await refresh();
    } finally {
      setActing("");
    }
  }
  const w = data?.widgets;
  return (
    <>
      <div className="dashboard-greeting">
        <div>
          <h2>Привет, {user.name?.split(" ")[0] || "друг"}.</h2>
          <p>Найдём время для того, что важно сегодня.</p>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Обновить сводку"
        >
          <RefreshCw size={18} className={busy ? "spinner" : ""} />
        </button>
      </div>
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
      {!data && busy && (
        <div className="product-loading">
          <LoaderCircle className="spinner" />
          Загружаем ваш день…
        </div>
      )}
      <div className="dashboard-grid">
        {w?.planning && (
          <Widget title="Планы на сегодня" onOpen={() => navigate("/planning")}>
            {w.planning.tasks.length === 0 && (
              <p className="muted">На сегодня пока нет задач.</p>
            )}
            {w.planning.tasks.map(({ task, occurrence }, i) => (
              <button
                className="dashboard-check"
                key={task.id + ":" + i}
                disabled={!!acting}
                role="checkbox"
                aria-checked={occurrence.status === "completed"}
                onClick={() =>
                  void toggle(
                    `/planning/tasks/${task.id}/${occurrence.status === "completed" ? "reopen" : "complete"}`,
                    {
                      version: task.version,
                      occurrence_at: occurrence.occurrence_at,
                    },
                    task.id,
                  )
                }
              >
                <span
                  className={occurrence.status === "completed" ? "done" : ""}
                >
                  {occurrence.status === "completed" && <Check size={14} />}
                </span>
                {task.title}
              </button>
            ))}
            {w.planning.events.map((e) => (
              <div className="dashboard-event" key={e.id + e.start_at}>
                <time>
                  {new Date(e.start_at).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: user.timezone,
                  })}
                </time>
                <span>{e.title}</span>
              </div>
            ))}
          </Widget>
        )}
        {w?.habits && (
          <Widget
            title="Маленькие шаги"
            onOpen={() => navigate("/modules/goals_habits")}
          >
            {w.habits.length === 0 && (
              <p className="muted">
                Добавьте привычку, чтобы отмечать её здесь.
              </p>
            )}
            {w.habits.map((h) => (
              <button
                className="dashboard-check"
                key={h.id}
                role="checkbox"
                aria-checked={!!h.today_complete}
                disabled={!!acting}
                onClick={() =>
                  void toggle(
                    `/habits/${h.id}/checkins`,
                    {
                      version: h.version,
                      day: data!.day,
                      value: h.today_complete ? 0 : h.target,
                    },
                    h.id,
                  )
                }
              >
                <span className={h.today_complete ? "done" : ""}>
                  {!!h.today_complete && <Check size={14} />}
                </span>
                {text(h.title)}
              </button>
            ))}
          </Widget>
        )}
        {w && "sleep" in w && (
          <Widget title="Ваш сон" onOpen={() => navigate("/modules/health")}>
            {w.sleep ? (
              <>
                <p className="record-metric">
                  {amount(w.sleep.hours)} <small>ч сна</small>
                </p>
                <p className="muted">
                  Последняя запись · {dateLabel(w.sleep.end_at)}
                </p>
              </>
            ) : (
              <p className="muted">Как вы спали? Добавьте первую запись.</p>
            )}
          </Widget>
        )}
        {w?.books && (
          <Widget
            title="Сейчас читаю"
            onOpen={() => navigate("/modules/books")}
          >
            {w.books.length === 0 ? (
              <p className="muted">На полке пока нет книг в чтении.</p>
            ) : (
              w.books.map((b) => (
                <div key={b.id}>
                  <h3>{text(b.title)}</h3>
                  <Progress
                    value={
                      b.total_pages
                        ? (Number(b.current_page) / Number(b.total_pages)) * 100
                        : 0
                    }
                    label={`${text(b.current_page)} / ${b.total_pages || "?"} страниц`}
                  />
                </div>
              ))
            )}
          </Widget>
        )}
        {!!w?.budgets?.length&&<Widget title="Бюджеты месяца" onOpen={()=>navigate('/modules/finance')}><div className="budget-bars">{w.budgets.map(b=><div key={b.id} className={Number(b.percent)>100?'over':Number(b.percent)>80?'near':''}><Progress value={Number(b.percent)} label={text(b.category)}/><small>Осталось {amount(b.remaining)} {text(b.currency)}</small></div>)}</div></Widget>}
        {w?.finance && (
          <Widget
            title="Деньги в этом месяце"
            onOpen={() => navigate("/modules/finance")}
          >
            {w.finance.length === 0 ? (
              <p className="muted">Добавьте первый доход или расход.</p>
            ) : (
              w.finance.map((r, i) => (
                <div className="intake-row" key={i}>
                  <span>{r.kind === "income" ? "Доходы" : "Расходы"}</span>
                  <strong>
                    {amount(r.amount)} {text(r.currency)}
                  </strong>
                </div>
              ))
            )}
          </Widget>
        )}
      </div>
    </>
  );
}
function Widget({
  title,
  onOpen,
  children,
}: {
  title: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-widget">
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onOpen}
          aria-label={`Открыть: ${title}`}
        >
          <ArrowRight size={18} />
        </button>
      </header>
      {children}
    </section>
  );
}
