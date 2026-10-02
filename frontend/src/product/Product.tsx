import {formatAmount} from "./format";
import { Avatar } from "../components/Avatar";
import exerciseNames from "./exercises.json";
import { displayWeight, storeWeight, weightLabel } from "./weight";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Crown,
  Heart,
  LayoutGrid,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { api, errorMessage, isDemo } from "../lib/api";
import { todayKey } from "../lib/dates";
import type { User, Notify } from "../lib/types";
import { Modal, ConfirmDialog, EmptyState, Logo } from "../components/ui";
import { Settings } from "../components/Settings";
import { sections, bodyFor } from "./schema";
import type { Row, Field, Section } from "./schema";
import { Dashboard, FinanceOverview, RecordDetail } from "./details";
import "./product.css";
import {
  HealthChart,
  BookStats,
  SmartGuide,
  WeightTarget,
  NutritionBalance,
  DiaryCalendar,
} from "./Extras";
const names: Record<string, string> = {
  dashboard: "Моё пространство",
  goals_habits: "Цели и привычки",
  health: "Здоровье",
  finance: "Финансы",
  books: "Книги и дневник",
};
const icons = {
  dashboard: LayoutGrid,
  goals_habits: Target,
  health: Heart,
  finance: Wallet,
  books: BookOpen,
};
export const isPro = (user: User) =>
  user.plan === "pro" ||
  (user.plan === "trial" &&
    !!user.trial_ends &&
    Date.parse(user.trial_ends) > Date.now());
export const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
export const amount = formatAmount;
export const dateLabel = (value: unknown) =>
  value
    ? new Date(
        text(value).length === 10 ? text(value) + "T12:00:00" : text(value),
      ).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
export function Product({
  user,
  module,
  navigate,
  onUserChange,
  onLogout,
  notify,
}: {
  user: User;
  module: string;
  navigate: (path: string) => void;
  onUserChange: (u: User) => void;
  onLogout: () => void;
  notify: Notify;
}) {
  const [tab, setTab] = useState(sections[module]?.[0]?.key ?? ""),
    [settings, setSettings] = useState<"profile" | "plan" | null>(null);
  const pro = isPro(user),
    allowed =
      pro || user.free_modules.includes(module) || module === "dashboard";
  useEffect(() => {
    setTab(sections[module]?.[0]?.key ?? "");
    document.title = `${names[module] || "Life Hub"} · Life Hub`;
  }, [module]);
  const section =
    sections[module]?.find((s) => s.key === tab) ?? sections[module]?.[0];
  return (
    <div className="product-layout">
      <a className="skip-link" href="#product-main">
        Перейти к содержимому
      </a>
      <header className="product-header">
        <button className="brand-button" onClick={() => navigate("/home")}>
          <Logo />
        </button>
        <button className="button ghost" onClick={() => setSettings("profile")}>
          <span className="profile-avatar">
            <Avatar user={user} />
          </span>
          <span>{user.name?.split(" ")[0] || "Профиль"}</span>
        </button>
      </header>
      <nav className="product-nav" aria-label="Разделы приложения">
        <button onClick={() => navigate("/planning")}>
          <ArrowLeft size={17} />
          Планирование
        </button>
        {Object.entries(names).map(([key, label]) => {
          const Icon = icons[key as keyof typeof icons];
          return (
            <button
              key={key}
              aria-current={key === module ? "page" : undefined}
              className={key === module ? "active" : ""}
              onClick={() =>
                navigate(key === "dashboard" ? "/home" : "/modules/" + key)
              }
            >
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </nav>
      <main id="product-main" className="product-main">
        <header className="product-title">
          <div>
            <span className="eyebrow">ВАША ЖИЗНЬ В ОДНОМ МЕСТЕ</span>
            <h1>
              {names[module]}
              <span className="heading-dot">.</span>
            </h1>
          </div>
          <span className="badge">
            {pro ? "Life Hub Pro" : "Life Hub Free"}
          </span>
        </header>
        {isDemo() ? (
          <EmptyState
            title="Новые разделы — в вашем аккаунте"
            text="Войдите или зарегистрируйтесь, чтобы сохранять привычки, здоровье, финансы и записи."
            action="Перейти ко входу"
            onAction={onLogout}
          />
        ) : !allowed ? (
          <Locked onPlan={() => setSettings("plan")} module />
        ) : module === "dashboard" ? (
          <Dashboard user={user} navigate={navigate} notify={notify} />
        ) : (
          <>
            <nav className="product-tabs" aria-label="Подразделы">
              {sections[module]?.map((s) => (
                <button
                  key={s.key}
                  aria-current={s.key === section?.key ? "page" : undefined}
                  className={s.key === section?.key ? "active" : ""}
                  onClick={() => setTab(s.key)}
                >
                  {s.label}
                  {s.pro && !pro && <Crown size={13} />}
                </button>
              ))}
            </nav>
            {section &&
              (section.pro && !pro ? (
                <Locked onPlan={() => setSettings("plan")} />
              ) : (
                <Records
                  key={section.path}
                  section={section}
                  user={user}
                  notify={notify}
                />
              ))}
          </>
        )}
      </main>
      {settings && (
        <Settings
          user={user}
          initialTab={settings}
          onClose={() => setSettings(null)}
          onUserChange={onUserChange}
          onLogout={onLogout}
          notify={notify}
        />
      )}
    </div>
  );
}
function Locked({
  onPlan,
  module = false,
}: {
  onPlan: () => void;
  module?: boolean;
}) {
  return (
    <EmptyState
      icon={<Crown size={28} />}
      title={
        module
          ? "Этот модуль не входит в ваш выбор Free"
          : "Возможность Life Hub Pro"
      }
      text={
        module
          ? "Остальные выбранные вами модули доступны в меню."
          : "Сохраняйте больше деталей и смотрите полную историю."
      }
      action="Посмотреть возможности"
      onAction={onPlan}
    />
  );
}
function useRows(path: string) {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  const load = useCallback(
    async (offset = 0) => {
      const seq = ++sequence.current;
      setBusy(true);
      setError("");
      try {
        const result = await api<{ items: Row[]; has_more: boolean }>(
          path + (path.includes("?") ? "&" : "?") + `limit=50&offset=${offset}`,
        );
        if (mounted.current && seq === sequence.current) {
          setRows((old) => (offset ? [...old, ...result.items] : result.items));
          setMore(result.has_more);
        }
      } catch (e) {
        if (mounted.current && seq === sequence.current)
          setError(errorMessage(e));
      } finally {
        if (mounted.current && seq === sequence.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [path],
  );
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);
  return { rows, loading, error, more, busy, load };
}
function Records({
  section: s,
  user,
  notify,
}: {
  section: Section;
  user: User;
  notify: Notify;
}) {
  const [editor, setEditor] = useState<Record<string, unknown> | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [query, setQuery] = useState(""),
    [searched, setSearched] = useState(""),
    [catalog, setCatalog] = useState(false),
    [busyId, setBusyId] = useState(""),
    [smart, setSmart] = useState(false),
    [filterDay, setFilterDay] = useState(""),
    [bookStatus, setBookStatus] = useState("");
  const base =
    s.key === "diary" && searched
      ? s.path + "/search?q=" + encodeURIComponent(searched)
      : s.path;
  const filter = filterDay
    ? "day=" + filterDay
    : bookStatus
      ? "status=" + bookStatus
      : "";
  const data = useRows(
      base + (filter ? (base.includes("?") ? "&" : "?") + filter : ""),
    ),
    pro = isPro(user),
    day = todayKey(user.timezone);
  async function toggle(h: Row) {
    if (busyId) return;
    setBusyId(h.id);
    try {
      await api(`/habits/${h.id}/checkins`, {
        method: "POST",
        body: {
          version: h.version,
          day,
          value: h.today_complete ? 0 : h.target,
        },
      });
      await data.load();
    } catch (e) {
      notify(errorMessage(e), "error");
      await data.load();
    } finally {
      setBusyId("");
    }
  }
  return (
    <section className="product-section">
      <div className="section-toolbar">
        <div>
          <h2>{s.label}</h2>
          <p>{s.description}</p>
        </div>
        <div className="product-actions">
          <button
            className="icon-button"
            disabled={data.busy}
            aria-label="Обновить"
            onClick={() => void data.load()}
          >
            <RefreshCw size={18} className={data.busy ? "spinner" : ""} />
          </button>
          {s.key === "books" && (
            <button
              className="button secondary"
              onClick={() => setCatalog(true)}
            >
              <Search size={16} />
              Найти книгу
            </button>
          )}
          {s.key === "goals" && (
            <button className="button secondary" onClick={() => setSmart(true)}>
              Помочь сформулировать
            </button>
          )}
          <button className="button primary" onClick={() => setEditor({})}>
            <Plus size={17} />
            Добавить
          </button>
        </div>
      </div>
      {["sleep", "weight", "workouts"].includes(s.key) && (
        <HealthChart section={s.key} user={user} revision={data.rows} />
      )}
      {s.key === "weight" && pro && (
        <WeightTarget
          unit={user.weight_unit}
          onChanged={() => void data.load()}
        />
      )}
      {s.key === "nutrition" && (
        <NutritionBalance user={user} revision={data.rows} />
      )}
      {s.key === "books" && pro && <BookStats revision={data.rows} />}
      {s.key === "books" && (
        <div className="product-search">
          <label className="product-field">
            Показать
            <select
              value={bookStatus}
              onChange={(e) => setBookStatus(e.target.value)}
            >
              <option value="">Все книги</option>
              <option value="want">Хочу прочитать</option>
              <option value="reading">Читаю</option>
              <option value="read">Прочитано</option>
            </select>
          </label>
        </div>
      )}
      {s.key === "diary" && (
        <DiaryCalendar
          selected={filterDay}
          onSelect={setFilterDay}
          user={user}
          revision={data.rows}
        />
      )}
      {s.key === "diary" && (
        <div className="product-search">
          <label className="product-field">
            Записи за день
            <input
              type="date"
              value={filterDay}
              onChange={(e) => setFilterDay(e.target.value)}
            />
          </label>
          {filterDay && (
            <button className="button ghost" onClick={() => setFilterDay("")}>
              Все дни
            </button>
          )}
        </div>
      )}
      {s.path.startsWith("/finance/") && (
        <FinanceOverview user={user} revision={data.rows} />
      )}
      {s.key === "diary" && pro && (
        <form
          className="product-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearched(query.trim());
          }}
        >
          <Search size={18} />
          <input
            aria-label="Поиск в дневнике"
            placeholder="Найти мысль или событие…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          <button className="button secondary" type="submit">
            Найти
          </button>
          {searched && (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setQuery("");
                setSearched("");
              }}
            >
              Сбросить
            </button>
          )}
        </form>
      )}
      {data.error && (
        <div role="alert" className="product-error">
          {data.error}
          <button className="text-button" onClick={() => void data.load()}>
            Повторить
          </button>
        </div>
      )}
      {data.loading ? (
        <div className="product-loading" role="status">
          <LoaderCircle size={24} className="spinner" />
          Загружаем записи…
        </div>
      ) : data.rows.length === 0 ? (
        <EmptyState
          title={
            searched ? "Ничего не найдено" : "Здесь начинается ваша история"
          }
          text={searched ? "Попробуйте другое слово." : s.description}
          action={searched ? undefined : "Добавить первую запись"}
          onAction={() => setEditor({})}
        />
      ) : (
        <div className={s.key === "diary" ? "diary-feed" : "record-grid"}>
          {data.rows.map((row) => (
            <article className={`record-card record-${s.key}`} key={row.id}>
              <div className="record-head">
                <span className="record-eyebrow">{subtitle(s, row)}</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label={`Изменить ${text(row.title) || s.singular}`}
                    onClick={() => setEditor(row)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Удалить ${text(row.title) || s.singular}`}
                    onClick={() => setDeleting(row)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <RecordContent section={s} row={row} user={user} />
              {s.key === "habits" && (
                <button
                  className="text-button"
                  disabled={!!busyId}
                  onClick={async () => {
                    setBusyId(row.id);
                    try {
                      await api("/habits/" + row.id, {
                        method: "PATCH",
                        body: {
                          ...bodyFor(s, row),
                          archived: !row.archived,
                          version: row.version,
                        },
                      });
                      await data.load();
                    } catch (e) {
                      notify(errorMessage(e), "error");
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  {row.archived ? "Вернуть из архива" : "В архив"}
                </button>
              )}
              <div className="record-bottom">
                {s.key === "habits" ? (
                  <>
                    <button
                      className={`button ${row.today_complete ? "secondary" : "primary"}`}
                      disabled={
                        !!busyId ||
                        Boolean(row.archived) ||
                        !((row.weekdays as number[]) || []).includes(
                          (new Date(day + "T12:00:00").getDay() + 6) % 7,
                        )
                      }
                      onClick={() => void toggle(row)}
                    >
                      {row.today_complete ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}{" "}
                      {row.today_complete ? "Выполнено" : "Отметить сегодня"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setDetail(row)}
                    >
                      История
                      <ChevronRight size={14} />
                    </button>
                  </>
                ) : ["goals", "medications", "debts", "savings"].includes(
                    s.key,
                  ) ? (
                  <button
                    className="text-button"
                    onClick={() => setDetail(row)}
                  >
                    {s.key === "goals"
                      ? "Открыть цель"
                      : s.key === "debts"
                        ? "Погашения"
                        : s.key === "savings"
                          ? "История баланса"
                          : "Отметки приёма"}
                    <ArrowRight size={15} />
                  </button>
                ) : s.key === "diary" ? (
                  <button
                    className="text-button"
                    onClick={() => setDetail(row)}
                  >
                    Читать запись
                    <ArrowRight size={15} />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {data.more && (
        <button
          className="button secondary load-more"
          disabled={data.busy}
          onClick={() => void data.load(data.rows.length)}
        >
          Показать ещё
        </button>
      )}
      {smart && (
        <SmartGuide
          onClose={() => setSmart(false)}
          onComplete={(values) => {
            setSmart(false);
            setEditor(values);
          }}
        />
      )}
      {editor && (
        <RecordEditor
          section={s}
          initial={editor}
          user={user}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            await api(s.path + (editor.id ? "/" + editor.id : ""), {
              method: editor.id ? "PATCH" : "POST",
              body: {
                ...body,
                ...(editor.id ? { version: editor.version } : {}),
              },
            });
            await data.load();
            notify("Запись сохранена");
            setEditor(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить запись?"
          description="Запись исчезнет из этого раздела. Остальные записи останутся на месте."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(
              s.path + "/" + deleting.id + "?version=" + deleting.version,
              { method: "DELETE" },
            );
            await data.load();
            notify("Запись удалена");
          }}
        />
      )}
      {catalog && (
        <Catalog
          onClose={() => setCatalog(false)}
          onSelect={(row) => {
            setCatalog(false);
            setEditor(row);
          }}
        />
      )}
      {detail && (
        <RecordDetail
          section={s}
          initial={detail}
          user={user}
          onClose={() => {
            setDetail(null);
            void data.load();
          }}
          notify={notify}
        />
      )}
    </section>
  );
}
function subtitle(s: Section, r: Row) {
  if (r.day) return dateLabel(r.day);
  if (r.month) return text(r.month);
  if (r.next_payment)
    return "Платёж " + dateLabel(r.next_due || r.next_payment);
  if (r.status)
    return (
      s.fields
        .find((f) => f.key === "status")
        ?.options?.find((o) => o[0] === r.status)?.[1] || text(r.status)
    );
  if (s.key === "sleep") return dateLabel(r.end_at);
  if (s.key === "habits")
    return r.archived
      ? "В архиве"
      : (r.weekdays as number[])
          .map((x) => ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][x])
          .join(" · ");
  return s.singular;
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="record-progress">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value)}%</strong>
      </div>
      <progress
        value={Math.min(100, Math.max(0, value))}
        max={100}
        aria-label={label}
      />
    </div>
  );
}
function RecordContent({
  section: s,
  row: r,
  user,
}: {
  section: Section;
  row: Row;
  user: User;
}) {
  return (
    <>
      {s.key === "books" && !!r.cover_id && (
        <img
          className="book-cover"
          src={`https://covers.openlibrary.org/b/id/${r.cover_id}-M.jpg`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <h3>
        {text(r.title) ||
          (s.key === "weight"
            ? amount(displayWeight(r.kg, user.weight_unit)) +
              " " +
              weightLabel(user.weight_unit)
            : s.key === "sleep"
              ? amount(
                  (Date.parse(text(r.end_at)) - Date.parse(text(r.start_at))) /
                    3600000,
                ) + " ч сна"
              : s.key === "diary"
                ? "Мысли дня"
                : text(r.category))}
      </h3>
      {!!r.author && <p className="muted">{text(r.author)}</p>}
      {!!r.description && (
        <p className="record-description">{text(r.description)}</p>
      )}
      {s.key === "goals" && (
        <>
          <Progress value={Number(r.progress)} label="Прогресс цели" />
          {!!r.due_date && <small>До {dateLabel(r.due_date)}</small>}
        </>
      )}
      {s.key === "habits" && (
        <p className="record-metric">
          {amount(r.today_value)} / {amount(r.target)}{" "}
          <small>{text(r.unit) || "за сегодня"}</small>
        </p>
      )}
      {s.key === "programs" && (
        <div>
          {(
            r.exercises as {
              name: string;
              sets: number;
              reps: number;
              kg: number | null;
            }[]
          ).map((e, i) => (
            <p key={i}>
              {e.name} · {e.sets} × {e.reps}
              {e.kg !== null ? " · " + e.kg + " кг" : ""}
            </p>
          ))}
        </div>
      )}
      {s.key === "workouts" && (
        <p className="record-metric">
          {amount(r.minutes)} <small>минут</small>
        </p>
      )}
      {s.key === "sleep" && (
        <p className="muted">Качество {text(r.quality)} из 5</p>
      )}
      {s.key === "nutrition" && (
        <>
          <p className="record-metric">
            {amount(r.calories)} <small>ккал</small>
          </p>
          <p className="muted">
            Б {amount(r.protein)} · Ж {amount(r.fat)} · У {amount(r.carbs)}
          </p>
        </>
      )}
      {s.key === "medications" && (
        <>
          <p>{text(r.dosage)}</p>
          <p className="muted">{(r.times as string[]).join(" · ")}</p>
        </>
      )}
      {r.amount !== undefined && (
        <p className={`record-metric ${r.kind === "income" ? "income" : ""}`}>
          {r.kind === "expense" ? "−" : r.kind === "income" ? "+" : ""}
          {amount(r.amount)} <small>{text(r.currency)}</small>
        </p>
      )}
      {s.key === "saving-goals" && (
        <>
          <Progress
            value={(Number(r.saved) / Number(r.target)) * 100}
            label="Накоплено"
          />
          <p>
            {amount(r.saved)} / {amount(r.target)} {text(r.currency)}
          </p>
          <small>До {dateLabel(r.due_date)}</small>
          {r.monthly_needed !== undefined && (
            <p className="muted">
              Откладывать примерно {amount(r.monthly_needed)} {text(r.currency)}{" "}
              / мес.
            </p>
          )}
        </>
      )}
      {s.key === "books" && (
        <>
          <Progress
            value={
              r.total_pages
                ? (Number(r.current_page) / Number(r.total_pages)) * 100
                : 0
            }
            label={`${text(r.current_page)} / ${r.total_pages || "?"} страниц`}
          />
          {!!r.rating && (
            <p aria-label={`Оценка ${r.rating} из 5`}>
              {"★".repeat(Number(r.rating))}
              {"☆".repeat(5 - Number(r.rating))}
            </p>
          )}
        </>
      )}
      {s.key === "diary" && (
        <p className="diary-preview">
          {text(r.text).slice(0, 100)}
          {text(r.text).length > 100 ? "…" : ""}
        </p>
      )}
    </>
  );
}
function RecordEditor({
  section: s,
  initial,
  user,
  onSave,
  onClose,
}: {
  section: Section;
  initial: Record<string, unknown>;
  user: User;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const fields = [
    ...s.fields.map((f) =>
      s.key === "weight" && f.key === "kg"
        ? {
            ...f,
            label: "Вес, " + weightLabel(user.weight_unit),
            max: displayWeight(1000, user.weight_unit),
          }
        : f.key === "category" && isPro(user)
          ? {
              ...f,
              type: "text" as const,
              hint: "Еда, транспорт, дом — или своя категория.",
            }
          : f,
    ),
    ...(s.key === "books" && isPro(user)
      ? [
          {
            key: "notes",
            label: "Заметки о книге",
            type: "textarea" as const,
            optional: true,
          },
        ]
      : []),
  ];
  const [values, setValues] = useState<Record<string, unknown>>(() => {
      const out = { ...initial };
      if (s.key === "weight" && out.kg !== undefined)
        out.kg = displayWeight(out.kg, user.weight_unit).toFixed(3);
      for (const f of fields) {
        if (out[f.key] === undefined)
          out[f.key] =
            f.initial ??
            (!f.optional && f.type === "date"
              ? todayKey(user.timezone)
              : f.type === "month"
                ? todayKey(user.timezone).slice(0, 7)
                : "");
        if (f.type === "datetime-local" && out[f.key]) {
          const d = new Date(text(out[f.key]));
          out[f.key] = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        }
      }
      return out;
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={`${initial.id ? "Изменить" : "Добавить"} · ${s.singular.toLowerCase()}`}
      onClose={() => !busy && onClose()}
      className="product-modal"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const body = bodyFor(s, values);
            if (s.key === "weight")
              body.kg = storeWeight(values.kg, user.weight_unit);
            await onSave(body);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body product-form">
          {fields.map((f) => (
            <FieldControl
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
            />
          ))}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spinner" />}Сохранить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function FieldControl({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = "field-" + f.key;
  if (f.type === "exercises") {
    const items = value as {
      name: string;
      sets: number;
      reps: number;
      kg: number | null;
    }[];
    return (
      <fieldset className="product-field full exercise-list">
        <legend>{f.label}</legend>
        <datalist id="exercise-catalog">
          {exerciseNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <small>
          Выберите название из справочника или введите своё. Подходы и нагрузку
          задайте по своей программе.
        </small>
        {items.map((item, i) => (
          <div key={i}>
            <label>
              Упражнение {i + 1}
              <input
                list="exercise-catalog"
                required
                value={item.name}
                maxLength={200}
                onChange={(e) =>
                  onChange(
                    items.map((v, j) =>
                      i === j ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
            {(["sets", "reps", "kg"] as const).map((key, n) => (
              <label key={key}>
                {["Подходы", "Повторы", "Вес, кг"][n]}
                <input
                  type="number"
                  required={key !== "kg"}
                  min={key === "kg" ? 0 : 1}
                  step={key === "kg" ? ".1" : "1"}
                  max={key === "sets" ? 100 : 1000}
                  value={item[key] ?? ""}
                  onChange={(e) =>
                    onChange(
                      items.map((v, j) =>
                        i === j
                          ? {
                              ...v,
                              [key]:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            }
                          : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="icon-button"
              type="button"
              disabled={items.length === 1}
              aria-label={"Убрать упражнение " + (i + 1)}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="button secondary"
          type="button"
          disabled={items.length >= 100}
          onClick={() =>
            onChange([...items, { name: "", sets: 3, reps: 10, kg: null }])
          }
        >
          Добавить упражнение
        </button>
      </fieldset>
    );
  }
  if (f.type === "weekdays")
    return (
      <fieldset className="product-field">
        <legend>{f.label}</legend>
        <div className="weekday-picker">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((name, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={(value as number[]).includes(i)}
              onClick={() =>
                onChange(
                  (value as number[]).includes(i)
                    ? (value as number[]).filter((x) => x !== i)
                    : [...(value as number[]), i],
                )
              }
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
    );
  if (f.type === "times")
    return (
      <fieldset className="product-field">
        <legend>{f.label}</legend>
        <div className="time-picker">
          {(value as string[]).map((v, i) => (
            <label key={i}>
              <span className="sr-only">Приём {i + 1}</span>
              <input
                type="time"
                required
                value={v}
                onChange={(e) =>
                  onChange(
                    (value as string[]).map((old, j) =>
                      i === j ? e.target.value : old,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                disabled={(value as string[]).length === 1}
                aria-label={`Убрать время ${v}`}
                onClick={() =>
                  onChange((value as string[]).filter((_, j) => j !== i))
                }
              >
                <Trash2 size={16} />
              </button>
            </label>
          ))}
        </div>
        {(value as string[]).length < 12 && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange([...(value as string[]), "18:00"])}
          >
            Добавить время
          </button>
        )}
      </fieldset>
    );
  return (
    <div className={`product-field ${f.type === "textarea" ? "full" : ""}`}>
      <label htmlFor={id}>
        {f.label}
        {f.optional && <span> · необязательно</span>}
      </label>
      {f.type === "textarea" ? (
        <textarea
          id={id}
          required={!f.optional}
          rows={f.key === "text" ? 9 : 3}
          value={text(value)}
          maxLength={f.key === "text" ? 100000 : 20000}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : f.type === "select" ? (
        <select
          id={id}
          required={!f.optional}
          value={text(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {f.options?.map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={f.type || "text"}
          required={!f.optional}
          value={text(value)}
          min={f.min}
          max={f.max}
          step={f.step ?? (f.type === "number" ? "1" : undefined)}
          maxLength={300}
          onChange={(e) => onChange(e.target.value)}
        />
      )}{" "}
      {f.hint && <small>{f.hint}</small>}
      {f.type === "datetime-local" && (
        <small>
          Часовой пояс устройства:{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </small>
      )}
    </div>
  );
}
function Catalog({
  onSelect,
  onClose,
}: {
  onSelect: (row: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  return (
    <Modal
      title="Найти книгу"
      description="Поиск по названию или автору в Open Library"
      onClose={onClose}
    >
      <div className="modal-body">
        <form
          className="product-search"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api<{ items: Record<string, unknown>[] }>(
                "/books/search?q=" + encodeURIComponent(query),
              );
              setRows(r.items);
              setSearched(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Название или автор"
            required
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spinner" />
            ) : (
              <Search size={16} />
            )}
            Найти
          </button>
        </form>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="catalog-results">
          {rows.map((row, i) => (
            <button key={i} onClick={() => onSelect(row)}>
              <BookOpen size={20} />
              <span>
                <strong>{text(row.title)}</strong>
                <small>{text(row.author)}</small>
              </span>
              <Plus size={18} />
            </button>
          ))}
        </div>
        {searched && !rows.length && (
          <p>
            Книг не найдено. Попробуйте другое название или добавьте книгу
            вручную.
          </p>
        )}
      </div>
    </Modal>
  );
}
