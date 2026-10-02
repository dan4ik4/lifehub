import { useEffect, useState } from "react";
import { Bell, LoaderCircle } from "lucide-react";
import {
  currentPush,
  disablePush,
  enablePush,
  pushSupported,
} from "../lib/push";
import { errorMessage, isDemo } from "../lib/api";

export function PushSettings() {
  const [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    currentPush()
      .then((s) => {
        if (alive) setEnabled(!!s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (enabled) await disablePush();
      else await enablePush();
      setEnabled(!enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-expand" aria-label="Уведомления">
      <div className="settings-row">
        <span className="settings-row-icon">
          <Bell size={19} />
        </span>
        <div className="settings-row-copy">
          <strong>Напоминания на этом устройстве</strong>
          <span>
            {enabled
              ? "Уведомления включены"
              : "Получайте напоминания о ваших планах"}
          </span>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() => void toggle()}
          disabled={busy || isDemo() || !pushSupported()}
        >
          {busy && <LoaderCircle size={16} className="spinner" />}
          {enabled ? "Выключить" : "Включить"}
        </button>
      </div>
      <p className="settings-help">
        Разрешение действует только для этого браузера. На iPhone установите
        сайт на экран «Домой». Содержимое личных планов не показывается на
        экране блокировки.
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
