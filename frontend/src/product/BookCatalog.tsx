import { t } from '../lib/language';
import { useState } from 'react';
import { BookOpen, LoaderCircle, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Modal } from '../components/ui';
import { text } from './recordPresentation';

export function BookCatalog({
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
      title={t("Найти книгу")}
      description={t("Поиск по названию или автору в Open Library")}
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
            aria-label={t("Название или автор")}
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
            {t("Найти")}
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
            {t("Книг не найдено. Попробуйте другое название или добавьте книгу вручную.")}
          </p>
        )}
      </div>
    </Modal>
  );
}
