import { language, t } from './lib/language';
import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './product/overview.css';
import './product/chat-media.css';
import './workspace.css';
import './figjam.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Credentials and user content are never logged. */ }
  render() { return this.state.failed ? <main className="fatal-error"><h1>{t("Давайте попробуем ещё раз")}</h1><p>{t("Не удалось отобразить страницу. Сохранённые планы останутся на месте.")}</p><button className="button primary" onClick={() => window.location.reload()}>{t("Обновить страницу")}</button></main> : this.props.children; }
}
const root = createRoot(document.getElementById('root')!);
document.documentElement.lang = language;
document.title = t('Life Hub — место для ваших планов');
document.querySelector('meta[name="description"]')?.setAttribute(
  'content', t('Life Hub — спокойное пространство для ваших задач, календаря и планов.'),
);
root.render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
