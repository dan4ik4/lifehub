import { displayWeight, storeWeight, weightLabel } from "./weight";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { todayKey, shiftDay } from "../lib/dates";
import type { User } from "../lib/types";
import type { Row } from "./schema";
import { Modal } from "../components/ui";
import { amount, dateLabel, text, isPro } from "./Product";
export function HealthChart({
  section,
  user,
  revision,
}: {
  section: string;
  user: User;
  revision: Row[];
}) {
  const [days, setDays] = useState(7),
    [rows, setRows] = useState<Row[]>([]),
    [target, setTarget] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController(),
      day = todayKey(user.timezone);
    setError("");
    api<Record<string, Row[]>>(
      `/health/summary?from=${shiftDay(day, -days + 1)}&to=${day}`,
      { signal: c.signal },
    )
      .then((r) => setRows(r[section] || []))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    if (section === "weight" && isPro(user))
      api<{ items: Row[] }>("/health/weight-targets", { signal: c.signal })
        .then((r) =>
          setTarget(
            r.items[0] ? displayWeight(r.items[0].kg, user.weight_unit) : null,
          ),
        )
        .catch(() => {});
    return () => c.abort();
  }, [section, user.timezone, user.weight_unit, days, revision]);
  const value = (r: Row) =>
      Number(
        section === "sleep"
          ? r.hours
          : section === "weight"
            ? displayWeight(r.kg, user.weight_unit)
            : r.minutes,
      ),
    unit =
      section === "sleep"
        ? "ч"
        : section === "weight"
          ? weightLabel(user.weight_unit)
          : "мин";
  const max = Math.max(1, ...rows.map(value), target || 0),
    shown = rows.slice(-31),
    min = Math.min(...rows.map(value), target ?? Infinity) - 1;
  const x = (i:number) => shown.length===1?300:60+i*520/(shown.length-1);
  const y = (v: number) => 110 - (90 * (v - min)) / (max + 1 - min);
  return (
    <section className="health-chart">
      <header>
        <h3>
          {section === "sleep"
            ? "Ритм сна"
            : section === "weight"
              ? "История веса"
              : "Время на движение"}
        </h3>
        <label>
          <span className="sr-only">Период графика</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            {isPro(user) && <option value={90}>90 дней</option>}
          </select>
        </label>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !shown.length ? (
        <p className="muted">Добавьте записи — здесь появится ваша история.</p>
      ) : (
        <>
          {section === "weight" ? (
            <svg
              className="weight-line-chart"
              viewBox="0 0 600 140"
              role="img"
              aria-label="График веса; точные значения в таблице ниже"
            >
              {[min,(min+max+1)/2,max+1].map(v=><g key={v}><line x1="60" x2="580" y1={y(v)} y2={y(v)} stroke="#edf0e8"/><text x="4" y={y(v)+4} fontSize="12" fill="#687465">{amount(v)}</text></g>)}
              {target !== null && (
                <>
                  <line
                    x1="20"
                    x2="580"
                    y1={y(target)}
                    y2={y(target)}
                    stroke="#b49454"
                    strokeDasharray="6 5"
                  />
                  <text x="24" y={y(target) - 6} fontSize="10" fill="#8e753c">
                    Цель {amount(target)} {weightLabel(user.weight_unit)}
                  </text>
                </>
              )}
              <polyline
                fill="none"
                stroke="#769467"
                strokeWidth="3"
                points={shown
                  .map(
                    (r, i) =>
                      `${x(i)},${y(value(r))}`,
                  )
                  .join(" ")}
              />
              {shown.map((r, i) => (
                <circle
                  key={r.id}
                  cx={x(i)}
                  cy={y(value(r))}
                  r="4"
                  fill="#24483e"
                >
                  <title>
                    {dateLabel(r.day)}: {amount(value(r))}{" "}
                    {weightLabel(user.weight_unit)}
                  </title>
                </circle>
              ))}
            </svg>
          ) : (
            <div
              className="health-bars"
              role="img"
              aria-label={`${shown.length} последних измерений; значения в таблице ниже`}
            >
              {shown.map((r) => (
                <div
                  key={r.id}
                  title={`${dateLabel(r.day || r.end_at)}: ${amount(value(r))} ${unit}`}
                >
                  <span
                    style={{
                      height: Math.max(4, (100 * value(r)) / max) + "%",
                    }}
                  />
                  <small>{text(r.day || r.end_at).slice(8, 10)}</small>
                </div>
              ))}
            </div>
          )}
          <div className="chart-caption"><span>{dateLabel(shown[0].day||shown[0].end_at)}</span><span>{unit}{shown.length>1?" · "+dateLabel(shown[shown.length-1].day||shown[shown.length-1].end_at):" · одно измерение"}</span></div>
          <details>
            <summary>Показать значения</summary>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>{unit}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateLabel(r.day || r.end_at)}</td>
                    <td>{amount(value(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {rows.length > 31 && (
            <small className="muted">
              На графике последние 31 измерение. Полная история периода — в
              таблице.
            </small>
          )}
        </>
      )}
    </section>
  );
}
export function BookStats({ revision }: { revision: Row[] }) {
  const [year, setYear] = useState(new Date().getFullYear()),
    [data, setData] = useState<{
      finished: number;
      pages: number;
      pages_per_reading_day: number | null;
      genres:Record<string,number>;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<{
      finished: number;
      pages: number;
      pages_per_reading_day: number | null;
      genres:Record<string,number>;
    }>("/books/stats?year=" + year, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [year, revision]);
  return (
    <div className="book-stats">
      <label>
        Мой год
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {Array.from(
            { length: 10 },
            (_, i) => new Date().getFullYear() - i,
          ).map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>
      {data && (
        <>
          <span>
            <strong>{data.finished}</strong> книг прочитано
          </span>
          <span>
            <strong>{data.pages}</strong> страниц
          </span>
          {Object.keys(data.genres).length>0&&<span>Жанры: {Object.entries(data.genres).map(([genre,count])=>`${genre==='other'?'Без жанра':genre} — ${count}`).join(', ')}</span>}
          {data.pages_per_reading_day !== null && (
            <span>
              <strong>{data.pages_per_reading_day}</strong> стр. за день чтения
            </span>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function SmartGuide({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (v: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    title: "",
    measure: "",
    steps: "",
    why: "",
    due_date: "",
  });
  return (
    <Modal
      title="Сформулировать цель"
      description="Пять вопросов, которые помогут сделать цель понятной."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onComplete({
            title: values.title,
            description: `Результат: ${values.measure}\nПервые шаги: ${values.steps}\nПочему это важно: ${values.why}`,
            due_date: values.due_date,
            status: "active",
            progress: 0,
          });
        }}
      >
        <div className="modal-body product-form">
          {[
            ["title", "Чего вы хотите достичь?"],
            ["measure", "Как вы поймёте, что цель достигнута?"],
            ["steps", "Какие посильные шаги сделаете?"],
            ["why", "Почему это важно для вас?"],
            ["due_date", "К какому сроку?"],
          ].map(([key, label]) => (
            <label className="product-field full" key={key}>
              {label}
              <input
                type={key === "due_date" ? "date" : "text"}
                required
                value={values[key]}
                maxLength={key === "title" ? 300 : 1000}
                onChange={(e) =>
                  setValues((old) => ({ ...old, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary">Перейти к созданию</button>
        </footer>
      </form>
    </Modal>
  );
}
export function GoalLinks({
  goalId,
  payload,
  onRefresh,
}: {
  goalId: string;
  payload: Record<string, unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [taskCursor,setTaskCursor]=useState<string|null>(null),[habitMore,setHabitMore]=useState(false);
  const [tasks, setTasks] = useState<Row[]>([]),
    [habits, setHabits] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [habitId, setHabitId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api<{ items: Row[];next_cursor:string|null }>("/planning/tasks?limit=100&completed=false", {
        signal: c.signal,
      }),
      api<{ items: Row[];has_more:boolean }>("/habits?limit=100", { signal: c.signal }),
    ])
      .then(([t, h]) => {
        setTasks(t.items);setTaskCursor(t.next_cursor);
        setHabits(h.items);setHabitMore(h.has_more);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [goalId]);
  const linked = (payload.tasks as Row[]) || [];
  async function link(kind: "task" | "habit") {
    setBusy(true);
    setError("");
    try {
      if (kind === "task")
        await api(`/goals/${goalId}/tasks`, {
          method: "POST",
          body: { task_id: selected },
        });
      else {
        const h = habits.find((h) => h.id === habitId)!;
        await api(`/habits/${h.id}`, {
          method: "PATCH",
          body: {
            title: h.title,
            kind: h.kind,
            target: h.target,
            unit: h.unit,
            weekdays: h.weekdays,
            reminder_time: h.reminder_time,
            goal_id: goalId,
            archived: h.archived,
            version: h.version,
          },
        });
        setHabits(old=>old.map(x=>x.id===h.id?{...x,goal_id:goalId}:x));
      }
      await onRefresh();
      setSelected("");
      setHabitId("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="goal-links">
      <h3>Связанные задачи</h3>
      {linked.map((t) => (
        <div className="intake-row" key={t.id}>
          <span>{text(t.title)}</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/goals/${goalId}/tasks/${t.id}`, {
                  method: "DELETE",
                });
                await onRefresh();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Отвязать
          </button>
        </div>
      ))}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void link("task");
        }}
      >
        <label className="product-field">
          Задача
          <select
            required
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Выберите задачу</option>
            {tasks
              .filter((t) => !linked.some((x) => x.id === t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {text(t.title)}
                </option>
              ))}
          </select>
        </label>
        <button className="button secondary" disabled={busy || !selected}>
          <Plus size={15} />
          Связать
        </button>
      </form>
      {taskCursor&&<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await api<{items:Row[];next_cursor:string|null}>(`/planning/tasks?limit=100&completed=false&cursor=${encodeURIComponent(taskCursor)}`);setTasks(old=>[...old,...r.items]);setTaskCursor(r.next_cursor);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>Загрузить ещё задачи</button>}
      <h3>Привычки для этой цели</h3>
      {((payload.habits as Row[]) || []).map((h) => (
        <div className="intake-row" key={h.id}>
          <span>{text(h.title)}</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/habits/${h.id}`, {
                  method: "PATCH",
                  body: {
                    title: h.title,
                    kind: h.kind,
                    target: h.target,
                    unit: h.unit,
                    weekdays: h.weekdays,
                    reminder_time: h.reminder_time,
                    archived: h.archived,
                    goal_id: null,
                    version: h.version,
                  },
                });
                await onRefresh();
                const refreshed=await api<Row>(`/habits/${h.id}`);
                setHabits(old=>old.some(x=>x.id===h.id)?old.map(x=>x.id===h.id?refreshed:x):[...old,refreshed]);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Отвязать
          </button>
        </div>
      ))}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void link("habit");
        }}
      >
        <label className="product-field">
          Привычка
          <select
            required
            value={habitId}
            onChange={(e) => setHabitId(e.target.value)}
          >
            <option value="">Выберите привычку</option>
            {habits
              .filter((h) => !h.goal_id&&!h.archived&&!((payload.habits as Row[])||[]).some(x=>x.id===h.id))
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {text(h.title)}
                </option>
              ))}
          </select>
        </label>
        <button className="button secondary" disabled={busy || !habitId}>
          <Plus size={15} />
          Связать
        </button>
      </form>
      {habitMore&&<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await api<{items:Row[];has_more:boolean}>(`/habits?limit=100&offset=${habits.length}`);setHabits(old=>[...old,...r.items]);setHabitMore(r.has_more);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>Загрузить ещё привычки</button>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function WeightTarget({
  onChanged,
  unit,
}: {
  onChanged: () => void;
  unit?: string;
}) {
  const [item, setItem] = useState<Row | null>(null),
    [kg, setKg] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<{ items: Row[] }>("/health/weight-targets", { signal: c.signal })
      .then((r) => {
        setItem(r.items[0] || null);
        setKg(r.items[0] ? displayWeight(r.items[0].kg, unit).toFixed(3) : "");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [unit]);
  return (
    <form
      className="weight-target inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const saved = await api<Row>(
            "/health/weight-targets" + (item ? "/" + item.id : ""),
            {
              method: item ? "PATCH" : "POST",
              body: {
                kg: storeWeight(kg, unit),
                ...(item ? { version: item.version } : {}),
              },
            },
          );
          setItem(saved);
          onChanged();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Ваша цель по весу, {weightLabel(unit)}
        <input
          type="number"
          min="0.001"
          max={displayWeight(1000, unit)}
          step="0.001"
          required
          value={kg}
          onChange={(e) => setKg(e.target.value)}
        />
      </label>
      <button className="button secondary" disabled={busy}>
        {item ? "Обновить цель" : "Сохранить цель"}
      </button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function NutritionBalance({
  user,
  revision,
}: {
  user: User;
  revision: Row[];
}) {
  const [day, setDay] = useState(todayKey(user.timezone)),
    [data, setData] = useState<Record<string, string> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<Record<string, string>>("/health/nutrition-summary?day=" + day, {
      signal: c.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [day, revision]);
  return (
    <div className="book-stats">
      <label>
        Питание за день
        <input
          type="date"
          required
          value={day}
          onChange={(e) => {
            if (e.target.value) setDay(e.target.value);
          }}
        />
      </label>
      {data &&
        [
          ["calories", "ккал"],
          ["protein", "г белка"],
          ["fat", "г жиров"],
          ["carbs", "г углеводов"],
        ].map(([k, label]) => (
          <span key={k}>
            <strong>{amount(data[k])}</strong> {label}
          </span>
        ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function DiaryCalendar({
  selected,
  onSelect,
  user,
  revision,
}: {
  selected: string;
  onSelect: (day: string) => void;
  user: User;
  revision: Row[];
}) {
  const today = todayKey(user.timezone),
    [month, setMonth] = useState(today.slice(0, 7)),
    [days, setDays] = useState<{ day: string; count: number }[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setDays([]);
    api<{ days: { day: string; count: number }[] }>(
      "/diary/calendar?month=" + month,
      { signal: c.signal },
    )
      .then((r) => setDays(r.days))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [month, revision]);
  const first = new Date(month + "-01T12:00:00"),
    offset = (first.getDay() + 6) % 7,
    count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return (
    <details className="diary-calendar">
      <summary>Календарь записей</summary>
      <label>
        Месяц
        <input
          type="month"
          value={month}
          min="1900-01"
          max={today.slice(0, 7)}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </label>
      <div className="diary-calendar-grid">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <small key={d}>{d}</small>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={"blank" + i} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = month + "-" + String(i + 1).padStart(2, "0"),
            entries = days.find((d) => d.day === day)?.count || 0;
          return (
            <button
              type="button"
              key={day}
              disabled={day > today}
              className={entries ? "has-entry" : ""}
              aria-pressed={selected === day}
              aria-label={`${dateLabel(day)}: записей ${entries}`}
              onClick={() => onSelect(selected === day ? "" : day)}
            >
              {i + 1}
              {entries > 0 && <span aria-hidden="true">{entries}</span>}
            </button>
          );
        })}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function MilestoneEditor({
  goalId,
  item,
  onRefresh,
}: {
  goalId: string;
  item: Row;
  onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState(text(item.title)),
    [progress, setProgress] = useState(Number(item.progress)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [removing, setRemoving] = useState(false);
  return (
    <form
      className="milestone-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(`/goals/${goalId}/milestones/${item.id}`, {
            method: "PATCH",
            body: { title, progress, version: item.version },
          });
          await onRefresh();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Этап
        <input
          value={title}
          required
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Прогресс, %
        <input
          type="number"
          value={progress}
          min={0}
          max={100}
          required
          onChange={(e) => setProgress(Number(e.target.value))}
        />
      </label>
      <button className="button secondary" disabled={busy}>
        Сохранить
      </button>
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={() => setRemoving(true)}
      >
        Удалить
      </button>
      {removing && (
        <div role="group" aria-label="Подтвердите удаление этапа">
          <span>Удалить этот этап?</span>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  `/goals/${goalId}/milestones/${item.id}?version=${item.version}`,
                  { method: "DELETE" },
                );
                await onRefresh();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Да, удалить
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setRemoving(false)}
          >
            Отмена
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
