import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Credentials and user content are never logged. */ }
  render() { return this.state.failed ? <main className="fatal-error"><h1>Давайте попробуем ещё раз</h1><p>Не удалось отобразить страницу. Сохранённые планы останутся на месте.</p><button className="button primary" onClick={() => window.location.reload()}>Обновить страницу</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
