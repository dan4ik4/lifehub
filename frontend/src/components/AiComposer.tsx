import { useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Sparkles } from 'lucide-react';
import { api, errorMessage, isDemo } from '../lib/api';
import type { Notify } from '../lib/types';

export function AiComposer({ onCreated, notify }: { onCreated: () => Promise<void>; notify: Notify }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('');
  const idempotency = useRef({ message: '', key: '' });
  const submit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true); setError(''); setResult('');
    if (idempotency.current.message !== message.trim()) idempotency.current = { message: message.trim(), key: crypto.randomUUID() };
    try {
      const response = await api<{ remaining_ai_requests: number; affected_resources: { type: string; id: string }[] }>('/ai/chat', { method: 'POST', body: { context: 'planning', mode: 'command', message: message.trim() }, headers: { 'Idempotency-Key': idempotency.current.key } });
      setResult(`Готово. Осталось запросов на сегодня: ${response.remaining_ai_requests}.`); setMessage(''); idempotency.current = { message: '', key: '' }; await onCreated(); notify('Добавлено в ваши планы');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <section className="ai-composer"><div className="ai-icon"><Sparkles size={20} /></div><div className="ai-content"><div className="ai-heading"><strong>Просто скажите, что в планах</strong><span>Luna AI</span></div><form onSubmit={e => { e.preventDefault(); void submit(); }}><input aria-label="Быстрый ввод с ИИ" maxLength={4000} placeholder="Например, напомни забрать посылку завтра в 18:00" value={message} onChange={e => setMessage(e.target.value)} disabled={busy} /><button className="ai-send" aria-label="Добавить с помощью ИИ" disabled={busy || !message.trim()}>{busy ? <LoaderCircle className="spinner" size={18} /> : <ArrowUp size={19} />}</button></form>{error && <p className="field-error" role="alert">{error}</p>}{result && <p className="ai-result" role="status">{result}</p>}{isDemo() && <small className="ai-demo-note">В демо добавляйте задачи вручную. ИИ доступен после входа.</small>}</div></section>;
}
