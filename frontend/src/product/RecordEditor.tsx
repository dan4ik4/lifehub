import { t } from '../lib/language';
import exerciseNames from './exercises.json';
import { displayWeight, storeWeight, weightLabel } from './weight';
import { useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { todayKey } from '../lib/dates';
import type { User } from '../lib/types';
import { Modal } from '../components/ui';
import { bodyFor } from './schema';
import type { Field, Section } from './schema';
import { isPro, text } from './recordPresentation';

export function RecordEditor({
  section: s,
  initial,
  user,
  onSave,
  onClose,
  onOpenExistingBook,
}: {
  section: Section;
  initial: Record<string, unknown>;
  user: User;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  onOpenExistingBook?: (id: string) => void;
}) {
  const fields = [
    ...s.fields.map((f) =>
      s.key === "weight" && f.key === "kg"
        ? {
            ...f,
            label: t("Вес, ") + weightLabel(user.weight_unit),
            max: displayWeight(1000, user.weight_unit),
          }
        : f.key === "category" && isPro(user)
          ? {
              ...f,
              type: "text" as const,
              hint: t("Еда, транспорт, дом — или своя категория."),
            }
          : f,
    ),
    ...(s.key === "books" && isPro(user)
      ? [
          {
            key: "notes",
            label: t("Заметки о книге"),
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
  const [changed, setChanged] = useState(false);
  const [shelfMatch, setShelfMatch] = useState<{id: string; title: string; author: string} | null>(null);
  const bookTitle = text(values.title), bookAuthor = text(values.author);
  const matchingBook = shelfMatch?.title === bookTitle && shelfMatch.author === bookAuthor ? shelfMatch : null;
  const close = () => {
    if (busy) return;
    if (s.key !== "diary" || !changed || window.confirm(t("Закрыть запись без сохранения?"))) onClose();
  };
  const renderField = (f: (typeof fields)[number]) => (
    <FieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => {
      setChanged(true);
      setValues((old) => ({ ...old, [f.key]: v }));
    }}/>
  );
  const notes = fields.find(field => field.key === "notes" && field.optional);
  return (
    <Modal
      title={`${initial.id ? t("Изменить") : t("Добавить")} · ${s.singular.toLowerCase()}`}
      onClose={close}
      className={`product-modal hub-record-editor${s.key === "diary" ? " diary-editor" : ""}`}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const body = bodyFor(s, values);
            if (s.key === "books" && !initial.id && !body.open_library_key && !matchingBook) {
              const query = new URLSearchParams({title: bookTitle, author: bookAuthor});
              const match = await api<{id: string | null}>('/books/shelf-match?' + query);
              if (match.id) {
                setShelfMatch({id: match.id, title: bookTitle, author: bookAuthor});
                return;
              }
            }
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
          {fields.filter(f => f !== notes).map(renderField)}
          {notes && <details className="hub-disclosure" open={Boolean(initial.notes)}>
            <summary>{notes.label}</summary>
            <div>{renderField(notes)}</div>
          </details>}
          {matchingBook && <div className="product-field full" role="status">
            <p>{t("Книга с таким названием и автором уже есть на полке.")}</p>
            {onOpenExistingBook && <button className="button secondary" type="button" disabled={busy}
              onClick={() => onOpenExistingBook(matchingBook.id)}>{t("Открыть книгу на полке")}</button>}
          </div>}
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
            onClick={close}
          >
            {t("Отмена")}
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spinner" />}{matchingBook ? t("Добавить ещё одно издание") : t("Сохранить")}
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
            <option key={name} value={t(name)} />
          ))}
        </datalist>
        <small>
          {t("Выберите название из справочника или введите своё. Подходы и нагрузку задайте по своей программе.")}
        </small>
        {items.map((item, i) => (
          <div key={i}>
            <label>
              {t("Упражнение")} {i + 1}
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
                {[t("Подходы"), t("Повторы"), t("Вес, кг")][n]}
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
              aria-label={t("Убрать упражнение ") + (i + 1)}
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
          {t("Добавить упражнение")}
        </button>
      </fieldset>
    );
  }
  if (f.type === "weekdays")
    return (
      <fieldset className="product-field">
        <legend>{f.label}</legend>
        <div className="weekday-picker">
          {[t("Пн"), t("Вт"), t("Ср"), t("Чт"), t("Пт"), t("Сб"), t("Вс")].map((name, i) => (
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
              <span className="sr-only">{t("Приём")} {i + 1}</span>
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
                aria-label={t("Убрать время {0}", v)}
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
            {t("Добавить время")}
          </button>
        )}
      </fieldset>
    );
  return (
    <div className={`product-field ${f.type === "textarea" ? "full" : ""}`}>
      <label htmlFor={id}>
        {f.label}
        {f.optional && <span> {t("· необязательно")}</span>}
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
          {t("Часовой пояс устройства:")}{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </small>
      )}
    </div>
  );
}
