import { t, locale } from '../lib/language';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Crown, Eye, EyeOff, Link2, Loader2, LockKeyhole, LogOut, Mail, RefreshCw, ShieldCheck, Smartphone, Sparkles, Unplug, UserRound } from 'lucide-react';
import { api, ApiError, errorMessage, isDemo } from '../lib/api';
import type { CalendarConnection, Notify, OtpChallenge, SyncJob, User } from '../lib/types';
import { Modal } from './ui';
import './settings.css';
import { LanguageSelect } from './LanguageSelect';
import { PushSettings } from './PushSettings';
import { PrivacySettings } from './PrivacySettings';
import { Avatar } from './Avatar';

type Tab = 'profile' | 'connections' | 'plan';
interface SettingsProps {
  user: User;
  onUserChange: (user: User) => void;
  onClose: () => void;
  onLogout: () => void;
  notify: Notify;
  initialTab?: Tab;
}

const OAUTH_KEY = 'lifehub.calendar.oauth.v1';
const TABS = [
  { id: 'profile' as const, label: t("Профиль"), icon: UserRound },
  { id: 'connections' as const, label: t("Календари"), icon: CalendarDays },
  { id: 'plan' as const, label: t("Мой план"), icon: Crown },
];

function prettyDate(value: string | null, timezone: string) {
  if (!value) return t("Ещё не синхронизирован");
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString(locale);
  }
}

function PasswordInput({ id, value, onChange, label, autoComplete, description, disabled }: {
  id: string; value: string; onChange: (value: string) => void; label: string; autoComplete: string; description?: string; disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="settings-password-input">
      <input className="input" id={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} required disabled={disabled} maxLength={1024} minLength={id.includes('current') ? undefined : 8} aria-describedby={description ? `${id}-help` : undefined} />
      <button className="settings-eye" type="button" disabled={disabled} aria-label={visible ? t("Скрыть пароль") : t("Показать пароль")} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
    </div>
    {description && <span id={`${id}-help`} className="settings-help">{description}</span>}
  </div>;
}

export function Settings({ user, onUserChange, onClose, onLogout, notify, initialTab = 'profile' }: SettingsProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(user.name);
  const [weightUnit,setWeightUnit]=useState(user.weight_unit||'kg');
  const [timezone, setTimezone] = useState(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, SyncJob>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true);
  const readControllers = useRef(new Set<AbortController>());
  const passwordAccount = user.auth_providers.includes('password');
  const trialActive = user.plan === 'trial' && !!user.trial_ends && new Date(user.trial_ends).getTime() > clock;
  const hasPro = user.plan === 'pro' || trialActive;
  const trialExpired = !!user.trial_ends && !hasPro;
  const planName = user.plan === 'pro' ? 'Pro' : trialActive ? t("Пробный Pro") : 'Free';
  const demo = isDemo();
  const resendIn = challenge ? Math.max(0, Math.ceil((new Date(challenge.resend_available_at).getTime() - clock) / 1000)) : 0;
  const otpExpired = !!challenge && new Date(challenge.otp_expires_at).getTime() <= clock;
  const otpLocked = !!challenge && challenge.attempts_left <= 0;
  const trialHours = trialActive ? Math.min(72, Math.max(1, Math.ceil((new Date(user.trial_ends!).getTime() - clock) / 3_600_000))) : 0;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of readControllers.current) controller.abort();
      readControllers.current.clear();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), challenge ? 1000 : 30_000);
    return () => window.clearInterval(interval);
  }, [challenge]);

  const resetProfile = () => {
    setName(user.name);
    setTimezone(user.timezone || 'UTC');
    setWeightUnit(user.weight_unit || 'kg');
  };
  useEffect(resetProfile, [user.name, user.timezone, user.weight_unit]);

  function setError(section: string, value = '') { setErrors(previous => ({ ...previous, [section]: value })); }

  async function loadConnections(signal?: AbortSignal) {
    if (!hasPro) return;
    const ownedController = signal ? null : new AbortController();
    if (ownedController) {
      readControllers.current.add(ownedController);
      signal = ownedController.signal;
    }
    setConnectionsLoading(true);
    setError('connections');
    try {
      const response = await api<{ items: CalendarConnection[] }>('/planning/calendar-connections', { signal });
      if (alive.current && !signal?.aborted) setConnections(response.items.filter(item => item.status !== 'disconnected'));
    } catch (error) {
      if (alive.current && !signal?.aborted) setError('connections', errorMessage(error));
    } finally {
      if (ownedController) readControllers.current.delete(ownedController);
      if (alive.current && !signal?.aborted) setConnectionsLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== 'connections' || !hasPro) { setConnectionsLoading(false); return; }
    const controller = new AbortController();
    readControllers.current.add(controller);
    void loadConnections(controller.signal);
    return () => { controller.abort(); readControllers.current.delete(controller); };
    // Connection refresh follows opening the panel and changes in entitlement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hasPro]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    document.getElementById(`settings-tab-${TABS[next].id}`)?.focus();
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError('profile');
    if (!name.trim()) { setError('profile', t("Введите имя.")); return; }
    try { new Intl.DateTimeFormat(locale, { timeZone: timezone.trim() }); }
    catch { setError('profile', t("Укажите часовой пояс, например Europe/Warsaw.")); return; }
    setBusy('profile');
    try {
      const updated = await api<User>('/users/me', { method: 'PATCH', body: { name: name.trim(), timezone: timezone.trim(), weight_unit:weightUnit } });
      onUserChange(updated);
      setEditingProfile(false);
      notify(t("Профиль сохранён"), 'success');
    } catch (error) { setError('profile', errorMessage(error)); }
    finally { if (alive.current) setBusy(null); }
  }

  async function sendEmailCode(event?: FormEvent) {
    event?.preventDefault();
    setError('email');
    setBusy('email');
    try {
      const next = await api<OtpChallenge>('/auth/change-email', { method: 'POST', body: { new_email: newEmail.trim().toLowerCase() } });
      setChallenge(next);
      setOtp('');
      setClock(Date.now());
      notify(t("Код отправлен на новый email"), 'success');
    } catch (error) {
      setError('email', errorMessage(error));
      if (error instanceof ApiError && error.code === 'otp_locked') setChallenge(previous => previous ? { ...previous, attempts_left: 0 } : previous);
    }
    finally { if (alive.current) setBusy(null); }
  }

  async function confirmEmail(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setError('email');
    if (!/^\d{6}$/.test(otp)) { setError('email', t("Введите шестизначный код из письма.")); return; }
    setBusy('email');
    try {
      const updated = await api<User>('/auth/confirm-email-change', { method: 'POST', body: { challenge_id: challenge.challenge_id, otp } });
      onUserChange(updated);
      setEmailExpanded(false);
      setChallenge(null);
      setOtp('');
      setNewEmail('');
      notify(t("Email изменён"), 'success');
    } catch (error) {
      setError('email', errorMessage(error));
      if (error instanceof ApiError && error.code === 'otp_locked') setChallenge(previous => previous ? { ...previous, attempts_left: 0 } : previous);
    }
    finally { if (alive.current) setBusy(null); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError('password');
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('password', t("Нужны минимум 8 символов, заглавная и строчная латинские буквы и цифра.")); return;
    }
    if (newPassword !== confirmPassword) { setError('password', t("Пароли не совпадают.")); return; }
    setBusy('password');
    try {
      await api<void>('/auth/change-password', { method: 'POST', body: { current_password: currentPassword, new_password: newPassword } });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      notify(t("Пароль изменён. Войдите с новым паролем."), 'success');
      onLogout();
    } catch (error) { setError('password', errorMessage(error)); }
    finally { if (alive.current) setBusy(null); }
  }

  async function activateTrial() {
    setError('plan');
    setBusy('trial');
    try {
      const updated = await api<User>('/users/me', { method: 'PATCH', body: { plan: 'trial' } });
      setClock(Date.now());
      onUserChange(updated);
      notify(t("Пробный Pro активирован на 72 часа"), 'success');
    } catch (error) { setError('plan', errorMessage(error)); }
    finally { if (alive.current) setBusy(null); }
  }

  async function connectGoogle() {
    if (!hasPro) { setTab('plan'); return; }
    setError('connections');
    setBusy('connect');
    const redirect_uri = `${window.location.origin}/calendar/callback`;
    try {
      const response = await api<{ authorize_url: string; state: string }>('/planning/calendar-connections/google/start', { method: 'POST', body: { redirect_uri } });
      const destination = new URL(response.authorize_url);
      if (destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com') throw new Error(t("Не удалось открыть безопасное подключение Google."));
      sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ state: response.state, provider: 'google', redirect_uri }));
      window.location.assign(response.authorize_url);
    } catch (error) {
      setError('connections', error instanceof ApiError && ['provider_unavailable', 'invalid_redirect_uri'].includes(error.code)
        ? t("Подключение Google Calendar ещё не настроено для этого приложения.") : errorMessage(error));
      setBusy(null);
    }
  }

  async function synchronize(connection: CalendarConnection) {
    if (!hasPro) { setTab('plan'); return; }
    if (syncingId) return;
    const controller = new AbortController();
    readControllers.current.add(controller);
    setSyncingId(connection.id);
    setError('connections');
    const requestTimeout = window.setTimeout(() => {
      if (alive.current && !controller.signal.aborted) notify(t("Ответ пока не получен. Проверьте статус календаря позже."), 'info');
      controller.abort();
    }, 60_000);
    try {
      const existing = jobs[connection.id];
      let job = existing && ['queued', 'running'].includes(existing.status)
        ? await api<SyncJob>(`/planning/calendar-connections/${connection.id}/sync/${existing.job_id}`, { signal: controller.signal })
        : await api<SyncJob>(`/planning/calendar-connections/${connection.id}/sync`, { method: 'POST', body: {}, signal: controller.signal });
      const deadline = Date.now() + 45_000;
      while (!controller.signal.aborted) {
        if (alive.current) setJobs(previous => ({ ...previous, [connection.id]: job }));
        if (job.status === 'done') {
          notify(t("Календарь синхронизирован"), 'success');
          await loadConnections(controller.signal);
          break;
        }
        if (job.status === 'failed') {
          const message = job.error_code === 'calendar_reauth_required' ? t("Подключите Google заново, чтобы продолжить синхронизацию.")
            : job.error_code === 'device_unavailable' ? t("Откройте Life Hub на подключённом iPhone и повторите синхронизацию.")
            : t("Не удалось синхронизировать календарь. Повторите попытку позже.");
          setError('connections', message);
          await loadConnections(controller.signal);
          setError('connections', message);
          break;
        }
        if (Date.now() >= deadline) {
          notify(t("Синхронизация продолжается в фоне. Статус можно проверить здесь."), 'info');
          break;
        }
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = window.setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 1500);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        job = await api<SyncJob>(`/planning/calendar-connections/${connection.id}/sync/${job.job_id}`, { signal: controller.signal });
      }
    } catch (error) {
      if (!controller.signal.aborted && alive.current) setError('connections', errorMessage(error));
    } finally {
      window.clearTimeout(requestTimeout);
      readControllers.current.delete(controller);
      if (alive.current) setSyncingId(null);
    }
  }

  async function disconnect(connection: CalendarConnection) {
    setBusy(`disconnect-${connection.id}`);
    setError('connections');
    try {
      await api<void>(`/planning/calendar-connections/${connection.id}`, { method: 'DELETE' });
      setConnections(previous => previous.filter(item => item.id !== connection.id));
      setDisconnectId(null);
      notify(t("Календарь отключён"), 'success');
    } catch (error) { setError('connections', errorMessage(error)); }
    finally { if (alive.current) setBusy(null); }
  }

  const googleConnection = connections.find(connection => connection.provider === 'google');

  return <Modal title={t("Настройки")} description={t("Немного о вас — и о том, как устроен ваш день.")} onClose={onClose} className="settings-modal">
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <div className="settings-person">
          <span className="settings-avatar" aria-hidden="true"><Avatar user={user}/></span>
          <div><strong>{user.name || t("Ваш профиль")}</strong><span className="settings-person-plan">{planName}</span></div>
        </div>
        <div className="settings-tabs" role="tablist" aria-label={t("Разделы настроек")}>
          {TABS.map(({ id, label, icon: Icon }, index) => <button type="button" key={id} id={`settings-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={`settings-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)} onKeyDown={event => moveTab(event, index)}><Icon size={18} /><span>{label}</span><ChevronRight size={15} className="settings-tab-arrow" /></button>)}
        </div>
        <button className="settings-logout" type="button" onClick={onLogout} disabled={!!busy}><LogOut size={17} />{t("Выйти из аккаунта")}</button>
      </aside>

      <section className="settings-panel" id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
        {tab === 'profile' && <>
          <div className="settings-heading"><h2>{t("Профиль и безопасность")}</h2></div>
          {demo && <div className="settings-demo-note"><Sparkles size={16} /><span>{t("Вы в деморежиме. Изменения остаются в этом браузере.")}</span></div>}
          {!editingProfile ? <div className="settings-profile-overview">
            <dl>
              <div><dt>{t("Имя")}</dt><dd>{user.name || '—'}</dd></div>
              <div><dt>{t("Часовой пояс")}</dt><dd>{user.timezone}</dd></div>
              <div><dt>{t("Единица веса")}</dt><dd>{user.weight_unit === 'lb' ? t("Фунты") : t("Килограммы")}</dd></div>
            </dl>
            <button className="button secondary" type="button" onClick={() => {resetProfile();setError('profile');setEditingProfile(true);}}>{t("Редактировать профиль")}</button>
          </div> : <form onSubmit={saveProfile} className="settings-profile-form" aria-busy={busy === 'profile'}>
            <div className="field"><label htmlFor="settings-name">{t("Как вас называть")}</label><input className="input" id="settings-name" disabled={!!busy} value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={50} required placeholder={t("Ваше имя")} /></div>
            <div className="field"><label htmlFor="settings-timezone">{t("Часовой пояс")}</label><input className="input" id="settings-timezone" disabled={!!busy} list="settings-timezones" value={timezone} onChange={event => setTimezone(event.target.value)} autoComplete="off" required aria-describedby="settings-timezone-help" /><datalist id="settings-timezones">{['Europe/Warsaw', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'Asia/Tbilisi', 'Asia/Almaty', 'Asia/Dubai', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(zone => <option key={zone} value={zone} />)}</datalist><span className="settings-help" id="settings-timezone-help">{t("Используется для событий и напоминаний.")}</span></div>
            {errors.profile && <p className="field-error" role="alert">{errors.profile}</p>}
            <div className="field"><label htmlFor="weight-unit">{t("Единица веса")}</label><select id="weight-unit" className="input" value={weightUnit} onChange={e=>setWeightUnit(e.target.value as "kg"|"lb")}><option value="kg">{t("Килограммы")}</option><option value="lb">{t("Фунты")}</option></select></div><div className="settings-form-actions settings-wrap"><button className="button secondary" type="button" disabled={!!busy} onClick={() => setEditingProfile(false)}>{t("Отмена")}</button><button className="button primary" type="submit" disabled={!!busy || (name.trim() === user.name && timezone === user.timezone && weightUnit === (user.weight_unit||"kg"))}>{busy === 'profile' ? <Loader2 size={16} className="settings-spin" /> : <Check size={16} />}{t("Сохранить изменения")}</button></div>
          </form>}

          <LanguageSelect disabled={!!busy} />
          <PushSettings /><PrivacySettings user={user} onLogout={onLogout} notify={notify} /><div className="settings-section-divider" />
          <div className="settings-row"><span className="settings-row-icon"><Mail size={19} /></span><div className="settings-row-copy"><strong>Email</strong><span className="settings-email-address">{user.email}{user.email_verified && <CheckCircle2 size={14} aria-label={t("Подтверждён")} />}</span></div>{passwordAccount && <button className="button ghost settings-small-button" type="button" disabled={!!busy} aria-expanded={emailExpanded} aria-controls="settings-email-form" onClick={() => { setEmailExpanded(!emailExpanded); setError('email'); }}>{t("Изменить")}</button>}</div>
          {!passwordAccount && !demo && <p className="settings-social-note"><ShieldCheck size={15} />{t("Вы входите через")} {user.auth_providers.includes('google') ? 'Google' : 'Apple'}{t(". Email управляется этим аккаунтом.")}</p>}
          {emailExpanded && <div className="settings-expand" id="settings-email-form">
            {!challenge ? <form onSubmit={sendEmailCode}><div className="field"><label htmlFor="settings-new-email">{t("Новый email")}</label><input className="input" id="settings-new-email" disabled={!!busy} autoFocus type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" required maxLength={254} placeholder="you@example.com" /></div>{errors.email && <p className="field-error" role="alert">{errors.email}</p>}<div className="settings-form-actions"><button className="button primary" type="submit" disabled={!!busy || newEmail.trim().toLowerCase() === user.email}>{busy === 'email' && <Loader2 size={16} className="settings-spin" />}{t("Отправить код")}<ArrowRight size={16} /></button></div></form>
              : <form onSubmit={confirmEmail} aria-busy={busy === 'email'}>{otpExpired && <p className="field-error" role="status">{t("Срок действия кода истёк. Запросите новый код.")}</p>}{otpLocked && <p className="field-error" role="status">{t("Попытки подтверждения исчерпаны. Смену email можно повторить позже.")}</p>}<p className="settings-verification-copy">{t("Введите код из письма на")} <strong>{newEmail.trim().toLowerCase()}</strong>{t(". Он действует 10 минут.")}</p><div className="field"><label htmlFor="settings-email-otp">{t("Код подтверждения")}</label><input className="input settings-otp" id="settings-email-otp" disabled={!!busy || otpExpired || otpLocked} autoFocus value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" /></div>{errors.email && <p className="field-error" role="alert">{errors.email}</p>}<div className="settings-form-actions settings-wrap"><button className="button primary" type="submit" disabled={!!busy || otp.length !== 6 || otpExpired || otpLocked}>{busy === 'email' && <Loader2 size={16} className="settings-spin" />}{t("Подтвердить email")}</button><button className="button ghost" type="button" onClick={() => void sendEmailCode()} disabled={!!busy || resendIn > 0 || otpLocked}>{resendIn > 0 ? t("Новый код через {0} с", resendIn) : t("Отправить ещё раз")}</button></div><button className="settings-text-button" type="button" disabled={!!busy} onClick={() => { setChallenge(null); setOtp(''); setError('email'); }}>{t("Указать другой email")}</button></form>}
          </div>}

          {passwordAccount && <><div className="settings-row settings-password-row"><span className="settings-row-icon"><LockKeyhole size={19} /></span><div className="settings-row-copy"><strong>{t("Пароль")}</strong><span>{t("Защитите своё пространство")}</span></div><button className="button ghost settings-small-button" type="button" disabled={!!busy} aria-expanded={passwordExpanded} aria-controls="settings-password-form" onClick={() => { setPasswordExpanded(!passwordExpanded); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setError('password'); }}>{t("Изменить")}</button></div>
            {passwordExpanded && <form onSubmit={changePassword} className="settings-expand" id="settings-password-form"><PasswordInput disabled={!!busy} id="settings-current-password" value={currentPassword} onChange={setCurrentPassword} label={t("Текущий пароль")} autoComplete="current-password" /><PasswordInput disabled={!!busy} id="settings-new-password" value={newPassword} onChange={setNewPassword} label={t("Новый пароль")} autoComplete="new-password" description={t("От 8 символов: заглавная и строчная латинские буквы и цифра.")} /><PasswordInput disabled={!!busy} id="settings-confirm-password" value={confirmPassword} onChange={setConfirmPassword} label={t("Повторите новый пароль")} autoComplete="new-password" />{errors.password && <p className="field-error" role="alert">{errors.password}</p>}<p className="settings-help">{t("После смены пароля потребуется войти заново.")}</p><div className="settings-form-actions"><button className="button primary" type="submit" disabled={!!busy}>{busy === 'password' && <Loader2 size={16} className="settings-spin" />}{t("Обновить пароль")}</button></div></form>}
          </>}
        </>}

        {tab === 'connections' && <>
          <div className="settings-heading"><h2>{t("Подключения календарей")}</h2></div>
          {!hasPro && <div className="settings-pro-callout"><span className="settings-callout-icon"><Crown size={22} /></span><div><strong>{t("Синхронизация доступна в Pro")}</strong><p>{t("Подключите внешний календарь, чтобы события обновлялись автоматически.")}</p><button type="button" className="button primary" onClick={() => setTab('plan')}>{trialExpired ? t("Посмотреть мой план") : t("Попробовать Pro")}<ArrowRight size={16} /></button></div></div>}
          {errors.connections && <div className="settings-error-box" role="alert"><p>{errors.connections}</p>{hasPro && <button className="settings-text-button" type="button" onClick={() => void loadConnections()} disabled={connectionsLoading}>{t("Обновить список")}</button>}</div>}
          {connectionsLoading && !connections.length ? <div className="settings-loading" role="status"><Loader2 size={19} className="settings-spin" />{t("Загружаем календари…")}</div> : <>
            <div className="settings-provider-card"><div className="settings-provider-top"><span className="settings-google-mark" aria-hidden="true">G</span><div><h3>Google Calendar</h3><p>{t("Ваш Google Календарь, рядом с планами")}</p></div>{googleConnection?.status === 'active' && <span className="settings-connected"><span />{t("Подключён")}</span>}</div>
              {!googleConnection && <div className="settings-provider-bottom"><span className="settings-provider-detail"><RefreshCw size={15} />{t("Двустороннее обновление событий")}</span><button className="button secondary" type="button" onClick={() => void connectGoogle()} disabled={!hasPro || !!busy || connectionsLoading}>{busy === 'connect' ? <Loader2 size={16} className="settings-spin" /> : <Link2 size={16} />}{t("Подключить")}</button></div>}
              {googleConnection && <ConnectionDetails connection={googleConnection} timezone={user.timezone} job={jobs[googleConnection.id]} busy={busy} syncingId={syncingId} disconnectId={disconnectId} setDisconnectId={setDisconnectId} onSync={synchronize} onDisconnect={disconnect} onReconnect={connectGoogle} />}
            </div>
            {connections.filter(connection => connection.provider === 'apple').map(connection => <div className="settings-provider-card" key={connection.id}><div className="settings-provider-top"><span className="settings-apple-mark"><CalendarDays size={24} /></span><div><h3>Apple Calendar</h3><p>{connection.account_label}</p></div><span className="settings-connected"><span />{t("На iPhone")}</span></div><ConnectionDetails connection={connection} timezone={user.timezone} job={jobs[connection.id]} busy={busy} syncingId={syncingId} disconnectId={disconnectId} setDisconnectId={setDisconnectId} onSync={synchronize} onDisconnect={disconnect} onReconnect={connectGoogle} /></div>)}
            {!connections.some(connection => connection.provider === 'apple') && <div className="settings-provider-card settings-provider-unavailable"><div className="settings-provider-top"><span className="settings-apple-mark"><CalendarDays size={24} /></span><div><h3>Apple Calendar</h3><p>{t("Подключение через приложение на iPhone")}</p></div><span className="settings-device-badge"><Smartphone size={13} />iPhone</span></div><div className="settings-provider-bottom"><p className="settings-help">{t("Apple Calendar подключается на устройстве через разрешение доступа к календарям. В браузере подключение недоступно.")}</p><button className="button secondary" type="button" disabled aria-label={t("Apple Calendar доступен только на iPhone")}><Smartphone size={16} />{t("На iPhone")}</button></div></div>}
          </>}
          <div className="settings-sync-note"><ShieldCheck size={18} /><p>{t("Сначала обновляются события из Life Hub, затем — изменения из внешнего календаря. Синхронизация работает в фоне.")}</p></div>
        </>}

        {tab === 'plan' && <>
          <div className="settings-heading"><h2>{t("Ваш план")}</h2></div>
          <div className={`settings-plan-card ${hasPro ? 'settings-plan-pro' : ''}`}><div className="settings-plan-top"><span className="settings-plan-icon"><Crown size={25} /></span><span className="settings-plan-current"><CheckCircle2 size={14} />{t("Текущий план")}</span></div><h3>{planName}</h3><p>{user.plan === 'pro' ? t("Все модули, полная история и расширенные возможности.") : trialActive ? t("Все возможности Pro открыты на время пробного периода.") : t("Всё необходимое, чтобы спокойно спланировать день.")}</p>{trialActive && <div className="settings-trial-progress"><div><Clock3 size={15} /><span>{t("Осталось около")} {trialHours}{t(" ч")}</span></div><progress value={Math.min(trialHours, 72)} max={72} aria-label={t("Оставшееся время пробного периода")} /><span>{t("До")} {prettyDate(user.trial_ends, user.timezone)}</span></div>}{trialExpired && <p className="settings-trial-ended">{t("Пробный период завершён. Ваши планы сохранены.")}</p>}</div>
          <div className="settings-feature-comparison"><div className="settings-feature-heading"><strong>{t("Возможности Life Hub")}</strong><span>{hasPro ? t("Включено") : 'Free / Pro'}</span></div>{[
            [t("Задачи, события и календарь"), true], [t("Список покупок"), true], [t("Повторяющиеся задачи и события"), hasPro], [t("Приоритеты и свои списки"), hasPro], ['Google Calendar', hasPro], [t("Все пять модулей"), hasPro], [t("Безлимитные привычки и цели"), hasPro], [t("Полная история здоровья"), hasPro], [t("Бюджеты, накопления и долги"), hasPro], [t("Статистика книг и поиск по дневнику"), hasPro],
          ].map(([label, included]) => <div className="settings-feature" key={String(label)}><span>{label}</span>{included ? <span className="settings-feature-check"><Check size={16} /><span className="settings-sr-only">{t("Включено")}</span></span> : <span className="settings-pro-tag">Pro</span>}</div>)}</div>
          {!hasPro && !user.trial_ends && <div className="settings-trial-cta"><div><Sparkles size={21} /><strong>{t("Попробуйте Pro в своём ритме")}</strong></div><p>{t("72 часа полного доступа. Без банковской карты.")}</p><button className="button primary" type="button" onClick={() => void activateTrial()} disabled={!!busy}>{busy === 'trial' ? <Loader2 size={17} className="settings-spin" /> : <Sparkles size={17} />}{t("Активировать 72 часа Pro")}<ArrowRight size={16} /></button></div>}
          {errors.plan && <p className="field-error" role="alert">{errors.plan}</p>}
          {!hasPro && <p className="settings-billing-note">{t("Покупка подписки пока недоступна. Мы сообщим, когда её можно будет оформить.")}</p>}
          <div className="settings-coming-soon"><span className="settings-coming-icon"><Sparkles size={19} /></span><div><strong>{t("Life Hub будет расти вместе с вами")}</strong><p>{t("Планирование, цели, здоровье, финансы и книги уже в одном пространстве. Новые интеграции будут появляться постепенно.")}</p></div></div>
        </>}
      </section>
    </div>
  </Modal>;
}

function ConnectionDetails({ connection, timezone, job, busy, syncingId, disconnectId, setDisconnectId, onSync, onDisconnect, onReconnect }: {
  connection: CalendarConnection; timezone: string; job?: SyncJob; busy: string | null; syncingId: string | null; disconnectId: string | null;
  setDisconnectId: (id: string | null) => void; onSync: (connection: CalendarConnection) => Promise<void>; onDisconnect: (connection: CalendarConnection) => Promise<void>; onReconnect: () => Promise<void>;
}) {
  const active = syncingId === connection.id;
  const pending = job && ['queued', 'running'].includes(job.status);
  return <div className="settings-connection-details">
    <p className="settings-connection-account">{connection.account_label}</p>
    <div className="settings-last-sync"><Clock3 size={14} /><span>{connection.last_synced_at ? t("Обновлено {0}", prettyDate(connection.last_synced_at, timezone)) : t("Первая синхронизация ещё не завершена")}</span></div>
    {connection.status === 'reauth_required' && <p className="settings-reauth" role="status">{connection.provider === 'google' ? t("Google запрашивает повторное подключение.") : t("Подключите календарь заново на iPhone.")}</p>}
    {active && <p className="settings-sync-status" role="status"><Loader2 size={14} className="settings-spin" />{job?.phase === 'wait_device' ? t("Ожидаем подтверждения на iPhone…") : job?.phase === 'pull' ? t("Получаем изменения календаря…") : t("Обновляем ваши события…")}</p>}
    {disconnectId === connection.id ? <div className="settings-disconnect-confirm" role="group" aria-label={t("Подтвердите отключение календаря")} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDisconnectId(null); } }}><p>{t("Отключить календарь? Автоматическое обновление событий остановится.")}</p><div><button className="button secondary" type="button" onClick={() => setDisconnectId(null)} disabled={!!busy}>{t("Отмена")}</button><button className="button danger" type="button" onClick={() => void onDisconnect(connection)} disabled={!!busy}>{busy === `disconnect-${connection.id}` && <Loader2 size={15} className="settings-spin" />}{t("Отключить")}</button></div></div>
      : <div className="settings-connection-actions">{connection.status === 'reauth_required' ? <button className="button secondary" type="button" onClick={() => void onReconnect()} disabled={!!busy || connection.provider === 'apple'}><Link2 size={15} />{connection.provider === 'apple' ? t("Повторите на iPhone") : t("Подключить заново")}</button> : <button className="button secondary" type="button" onClick={() => void onSync(connection)} disabled={!!busy || !!syncingId}>{active ? <Loader2 size={15} className="settings-spin" /> : <RefreshCw size={15} />}{active ? t("Синхронизация…") : pending ? t("Проверить статус") : t("Синхронизировать")}</button>}<button className="settings-disconnect-button" type="button" onClick={() => setDisconnectId(connection.id)} disabled={!!busy || active}><Unplug size={15} />{t("Отключить")}</button></div>}
  </div>;
}

export default Settings;
