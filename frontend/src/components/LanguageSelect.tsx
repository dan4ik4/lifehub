import { useId, useState } from 'react';
import { language, saveLanguage, t } from '../lib/language';
import type { Language } from '../lib/language';

export function LanguageSelect({ disabled = false }: { disabled?: boolean }) {
  const id = useId();
  const [failed, setFailed] = useState(false);

  function changeLanguage(next: Language) {
    if (next === language) return;
    try {
      saveLanguage(next);
      window.location.reload();
    } catch {
      setFailed(true);
    }
  }

  return <div className="field language-select">
    <label htmlFor={id}>{t('Язык интерфейса')}</label>
    <select id={id} className="input" value={language} onChange={event => changeLanguage(event.target.value as Language)}
      disabled={disabled} aria-describedby={failed ? `${id}-error` : undefined}>
      <option value="ru" lang="ru">Русский</option>
      <option value="en" lang="en">English</option>
    </select>
    {failed && <span className="field-error" id={`${id}-error`} role="alert">
      {t('Не удалось сохранить язык на этом устройстве.')}
    </span>}
  </div>;
}
