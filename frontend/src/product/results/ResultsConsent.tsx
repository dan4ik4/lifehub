import {useState} from 'react';
import {Modal} from '../../components/ui';
import {api,errorMessage} from '../../lib/api';
import {t} from '../../lib/language';
import {ResultsIcon, useResults} from './shared';
import type {Consent} from './shared';

export const resultsPrefs = '/insights/preferences';
export const resultsConsentChanged = 'lifehub:results-consent';
export async function saveConsent(enabled:boolean) {
  const value = await api<Consent>(resultsPrefs, {method:'PATCH',body:{ai_enabled:enabled}});
  window.dispatchEvent(new Event(resultsConsentChanged));
  return value;
}

export function ConsentDialog({enabled,pro,close,onSave}:{enabled:boolean;pro:boolean;close:()=>void;onSave:(value:Consent)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async (value:boolean)=>{
    setBusy(true);setError('');
    try {onSave(await saveConsent(value));close();}
    catch (cause) {setError(errorMessage(cause));}
    finally {setBusy(false);}
  };
  return <Modal title={t('ИИ-итоги')} onClose={()=>{if(!busy)close();}} className="results-dialog">
    <div className="modal-body results-consent-body">
      <p>{t('Согласие сохраняется в аккаунте. Вы можете изменить его в настройках.')}</p>
      <ul>
        <li>{t('Для недельного вывода OpenAI получает сводные числа из доступных модулей.')}</li>
        <li>{t('Текст дневника, заголовки и даты передаются только при запуске обзора дневника за выбранную неделю.')}</li>
        <li>{t('При запуске разбора месяца передаются сводные суммы, категории, бюджеты и условия прогноза.')}</li>
      </ul>
      <p>{t('Итоги и связи доступны без согласия на ИИ.')}</p>
      {!pro&&<p>{t('ИИ-итоги доступны с Pro или в пробном периоде.')}</p>}
      {error&&<p role="alert">{error}</p>}
    </div>
    <footer className="modal-footer"><button type="button" disabled={busy} className="results-button" onClick={()=>void save(false)}>
      {enabled?t('Выключить ИИ-итоги'):t('Продолжить без ИИ')}</button>
      {pro&&!enabled&&<button type="button" className="results-button results-primary" disabled={busy} onClick={()=>void save(true)}>{t('Включить ИИ-итоги')}</button>}
    </footer>
  </Modal>;
}

export function ResultsSettings({pro,enabled=true}:{pro:boolean;enabled?:boolean}) {
  const {data,reload} = useResults<Consent>(enabled?resultsPrefs:null);
  const [open,setOpen] = useState(false);
  if (!enabled) return null;
  return <section className="results-settings">
    <h3>{t('ИИ-итоги')}</h3>
    <p>{data?.ai_enabled?t('ИИ-итоги включены'):t('ИИ-итоги выключены')}</p>
    <button className="button secondary" type="button" onClick={()=>setOpen(true)}>
      <ResultsIcon name="sparkles" size={16}/>{t('Что передаётся')}</button>
    {open&&<ConsentDialog enabled={!!data?.ai_enabled} pro={pro} close={()=>setOpen(false)} onSave={reload}/>}
  </section>;
}
