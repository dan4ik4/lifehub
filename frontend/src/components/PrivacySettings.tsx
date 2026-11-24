import { t } from '../lib/language';
import { useEffect, useState } from "react";
import { Download, LoaderCircle, Trash2, Upload } from "lucide-react";
import { api, errorMessage, isDemo } from "../lib/api";
import type { Notify, User } from "../lib/types";
import { Modal } from "./ui";
import {AssistantPreferences} from "./AssistantPreferences";
type ExportJob = {
  id: string;
  format: "json" | "csv";
  status: string;
  expires_at: string;
};
export function PrivacySettings({
  user,
  onLogout,
  notify,
}: {
  user: User;
  onLogout: () => void;
  notify: Notify;
}) {
  const [avatar, setAvatar] = useState<string | null>(null),
    [exports, setExports] = useState<ExportJob[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [password, setPassword] = useState("");
  const demo = isDemo();
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    api<{ data: string | null }>("/users/me/avatar", { signal: c.signal })
      .then((r) => setAvatar(r.data))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    api<{ items: ExportJob[] }>("/users/me/exports", { signal: c.signal })
      .then((r) => setExports(r.items))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [demo]);
  const pending = exports.some((e) => e.status === "queued");
  useEffect(() => {
    if (!pending) return;
    const c = new AbortController();
    const timer = window.setInterval(() => {
      api<{ items: ExportJob[] }>("/users/me/exports", { signal: c.signal })
        .then((r) => setExports(r.items))
        .catch(() => {});
    }, 3000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [pending]);
  async function requestExport(format: "json" | "csv") {
    setBusy("export");
    setError("");
    try {
      const job = await api<ExportJob>("/users/me/exports", {
        method: "POST",
        body: { format },
      });
      setExports((old) => [job, ...old]);
      notify(t("Готовим копию ваших данных"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function download(id: string) {
    setBusy(id);
    try {
      const result = await api<{
        data: string;
        filename: string;
        mime: string;
      }>("/users/me/exports/" + id);
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="privacy-settings">
      <AssistantPreferences userId={user.id}/>
      <div className="settings-divider" />
      <h3>{t("Фото профиля")}</h3>
      <div className="privacy-avatar-row">
        {avatar ? (
          <img src={avatar} alt={t("Ваше фото профиля")} />
        ) : (
          <span className="profile-avatar">{user.name.slice(0, 1)}</span>
        )}
        <label className="button secondary">
          <Upload size={16} />
          {busy === "avatar" ? t("Загружаем…") : t("Выбрать фото")}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={demo || !!busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError("");
              if (file.size > 650000) {
                setError(t("Выберите фото меньше 650 КБ."));
                return;
              }
              setBusy("avatar");
              try {
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
                await api("/users/me/avatar", {
                  method: "POST",
                  body: { data },
                });
                setAvatar(
                  (await api<{ data: string }>("/users/me/avatar")).data,
                );
                window.dispatchEvent(new Event("lifehub:avatar"));
                notify(t("Фото сохранено"));
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy("");
                e.target.value = "";
              }
            }}
          />
        </label>
        {avatar && (
          <button
            className="icon-button"
            aria-label={t("Удалить фото")}
            disabled={!!busy}
            onClick={async () => {
              setBusy("avatar");
              try {
                await api("/users/me/avatar", { method: "DELETE" });
                setAvatar(null);
                window.dispatchEvent(new Event("lifehub:avatar"));
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy("");
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <p className="settings-help">
        {t("JPG, PNG или WebP до 650 КБ. Фото доступно только в вашем аккаунте.")}
      </p>
      <div className="settings-divider" />
      <h3>{t("Копия ваших данных")}</h3>
      <p className="settings-help">
        {t("Сохранённые записи из всех разделов. Файл будет доступен 24 часа.")}
      </p>
      <div className="privacy-buttons">
        <button
          className="button secondary"
          disabled={demo || !!busy}
          onClick={() => void requestExport("json")}
        >
          <Download size={16} />
          {t("Экспорт JSON")}
        </button>
        <button
          className="button secondary"
          disabled={demo || !!busy}
          onClick={() => void requestExport("csv")}
        >
          <Download size={16} />
          {t("Таблицы CSV")}
        </button>
      </div>
      {exports.map((job) => (
        <div className="privacy-export" key={job.id}>
          <span>
            {job.format.toUpperCase()} ·{" "}
            {job.status === "queued"
              ? t("Готовим файл…")
              : job.status === "ready"
                ? t("Готов к скачиванию")
                : t("Не удалось подготовить")}
          </span>
          {job.status === "queued" && (
            <LoaderCircle size={16} className="spinner" />
          )}
          {job.status === "ready" && (
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => void download(job.id)}
            >
              {t("Скачать")}
            </button>
          )}
        </div>
      ))}
      <div className="settings-divider" />
      <h3>{t("Удаление аккаунта")}</h3>
      <p className="settings-help">
        {t("Доступ закроется сразу. Через 30 дней аккаунт и его данные будут удалены окончательно. В течение этих 30 дней восстановление доступно через администратора.")}
      </p>
      <button
        className="button ghost danger-text"
        disabled={demo || !user.auth_providers.includes("password")}
        onClick={() => setDeleting(true)}
      >
        {t("Удалить мой аккаунт")}
      </button>
      {!user.auth_providers.includes("password") && (
        <p className="settings-help">
          {t("Для аккаунта Google или Apple пока требуется обращение к администратору.")}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {deleting && (
        <Modal
          title={t("Удалить аккаунт?")}
          onClose={() => !busy && setDeleting(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("delete");
              setError("");
              try {
                await api("/users/me", {
                  method: "DELETE",
                  body: { password, confirm: "DELETE" },
                });
                setPassword("");
                notify(t("Аккаунт отмечен для удаления"));
                onLogout();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy("");
              }
            }}
          >
            <div className="modal-body">
              <p>
                {t("Доступ будет закрыт на всех устройствах. Введите пароль, чтобы подтвердить удаление.")}
              </p>
              <label className="field">
                {t("Текущий пароль")}
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
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
                disabled={!!busy}
                onClick={() => setDeleting(false)}
              >
                {t("Отмена")}
              </button>
              <button className="button danger" disabled={!!busy}>
                {t("Удалить аккаунт")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
