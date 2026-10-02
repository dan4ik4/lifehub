import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, Eye, EyeOff, Leaf, LockKeyhole, Mail, ShieldCheck, Sparkles, CalendarDays, CircleCheck, Globe2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { AuthSession, OtpChallenge, User } from '../lib/types';
import { appleConfigured, googleConfigured, mountGoogleButton, prepareAppleSignIn } from '../lib/social';
import type { SocialCredential } from '../lib/social';
import './auth.css';

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'success';
type Errors = Record<string, string>;
const registrationKey = 'lifehub.pending-registration';

function savedRegistration(): { email: string; challenge: OtpChallenge } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(registrationKey) || 'null');
    return typeof saved?.email === 'string' && typeof saved?.challenge?.challenge_id === 'string'
      && Date.parse(saved.challenge.registration_expires_at) > Date.now() ? saved : null;
  } catch { return null; }
}

function Brand() {
  return <a className="auth-brand" href="/" aria-label="Life Hub — главная"><span className="auth-brand-mark"><Leaf size={21} strokeWidth={1.7} /></span>life<span>hub</span><span className="auth-brand-dot" /></a>;
}

function AuthShell({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  return <main className={`auth-page${onboarding ? ' auth-page-onboarding' : ''}`}>
    <section className="auth-story" aria-label="Life Hub — ваше личное пространство">
      <Brand />
      <div className="auth-story-content">
        <div className="auth-overline"><span /> ВАШ ДЕНЬ, В ВАШЕМ РИТМЕ</div>
        <h1>{onboarding ? <>Планы, которые<br />близки <em>вам.</em></> : <>Меньше суеты.<br />Больше <em>жизни.</em></>}</h1>
        <p>Освободите голову для важного.<br />Задачи, встречи и маленькие планы —<br className="auth-story-break" /> всё в одном спокойном месте.</p>
        <div className="auth-illustration" aria-hidden="true">
          <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
          <div className="auth-orb" /><div className="auth-leaf-shape" />
          <div className="auth-today-card"><div className="auth-today-top"><span>Мой день</span><span>•••</span></div><div className="auth-today-sub">Место для самого важного</div>
            <div className="auth-illustration-task"><span className="auth-mini-check"><Check size={11} /></span><span>Прогулка без телефона</span></div>
            <div className="auth-illustration-task"><span className="auth-mini-circle" /><span>Время для новой идеи</span></div>
            <div className="auth-illustration-task"><span className="auth-mini-circle" /><span>Ужин с близкими</span></div>
            <div className="auth-card-progress"><i /></div>
          </div>
          <div className="auth-calendar-chip"><CalendarDays size={22} /><div><strong>Всё на своём месте</strong><span>Можно просто выдохнуть</span></div></div>
          <div className="auth-spark auth-spark-one">✳</div><div className="auth-spark auth-spark-two">✧</div>
        </div>
      </div>
      <div className="auth-story-footer"><span>Чуть больше порядка. Чуть больше свободы.</span><span>© {new Date().getFullYear()} Life Hub</span></div>
    </section>
    <section className="auth-panel"><div className="auth-mobile-brand"><Brand /></div>{children}<div className="auth-panel-footer"><ShieldCheck size={14} /> Личное пространство, только для вас</div></section>
  </main>;
}

function PasswordField({ value, onChange, label = 'Пароль', error, autoComplete = 'current-password', hint, disabled }: {
  value: string; onChange: (value: string) => void; label?: string; error?: string; autoComplete?: string; hint?: boolean; disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label><div className="auth-password-wrap">
    <input id={id} className="input" type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)}
      autoComplete={autoComplete} maxLength={1024} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error || hint ? `${id}-help` : undefined} placeholder="Введите пароль" />
    <button type="button" className="auth-password-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? `Скрыть: ${label}` : `Показать: ${label}`} aria-pressed={visible} disabled={disabled}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
  </div>{error ? <span className="field-error" id={`${id}-help`}>{error}</span> : hint && <span className="auth-field-hint" id={`${id}-help`}>От 8 символов: заглавная и строчная буквы, цифра.</span>}</div>;
}

export function OtpInput({ value, onChange, error, disabled, label = 'Код из письма' }: { value: string; onChange: (value: string) => void; error?: string; disabled?: boolean; label?: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const id = useId();
  const write = (input: string, index: number) => {
    const digits = input.replace(/\D/g, '').slice(0, 6);
    const start = digits.length === 6 ? 0 : index;
    const next = Array.from({ length: 6 }, (_, position) => value[position]?.trim() || ' ');
    if (!digits) next[index] = ' ';
    else [...digits].forEach((digit, offset) => { if (start + offset < 6) next[start + offset] = digit; });
    onChange(next.join(''));
    if (digits) refs.current[Math.min(start + digits.length, 5)]?.focus();
  };
  return <fieldset className="auth-otp-field" aria-describedby={error ? `${id}-error` : undefined} disabled={disabled}>
    <legend>{label}</legend><div className="auth-otp-inputs">{Array.from({ length: 6 }, (_, index) => <input
      key={index} ref={element => { refs.current[index] = element; }} className="input" inputMode="numeric" pattern="[0-9]*" type="text"
      aria-label={`Цифра ${index + 1} из 6`} aria-invalid={Boolean(error)} autoComplete={index === 0 ? 'one-time-code' : 'off'}
      value={value[index]?.trim() || ''} maxLength={6} onFocus={event => event.currentTarget.select()}
      onChange={event => write(event.target.value, index)}
      onPaste={event => { event.preventDefault(); write(event.clipboardData.getData('text'), index); }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); refs.current[index - 1]?.focus(); }
        if (event.key === 'ArrowRight' && index < 5) { event.preventDefault(); refs.current[index + 1]?.focus(); }
        if (event.key === 'Backspace' && !value[index]?.trim() && index > 0) { event.preventDefault(); write('', index - 1); refs.current[index - 1]?.focus(); }
      }} />)}</div>{error && <span className="field-error" id={`${id}-error`}>{error}</span>}
  </fieldset>;
}

function SocialButtons({ onCredential, onError, busy }: { onCredential: (credential: SocialCredential) => void; onError: (error: unknown) => void; busy: boolean }) {
  const googleElement = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError });
  callbacks.current = { onCredential, onError };
  const [googleFailed, setGoogleFailed] = useState(false);
  const [appleReady, setAppleReady] = useState<(() => Promise<SocialCredential>) | null>(null);
  const [appleFailed, setAppleFailed] = useState(false);
  const [applePending, setApplePending] = useState(false);
  useEffect(() => {
    if (!googleConfigured || !googleElement.current) return;
    return mountGoogleButton(googleElement.current, credential => callbacks.current.onCredential(credential), error => {
      setGoogleFailed(true); callbacks.current.onError(error);
    });
  }, []);
  useEffect(() => {
    if (!appleConfigured) return;
    let active = true;
    void prepareAppleSignIn().then(signIn => { if (active) setAppleReady(() => signIn); }).catch(error => {
      if (active) { setAppleFailed(true); callbacks.current.onError(error); }
    });
    return () => { active = false; };
  }, []);
  return <><div className="auth-social-buttons" aria-label="Другие способы входа">
    {googleConfigured && !googleFailed ? <div className="auth-google-button" ref={googleElement} inert={busy} /> :
      <button className="auth-social-button" type="button" disabled title="Вход через Google пока не подключён"><span className="auth-google-g">G</span>Google <span className="auth-provider-status">Недоступен</span></button>}
    <button className="auth-social-button auth-apple-button" type="button" disabled={!appleReady || busy || applePending} onClick={() => {
      if (!appleReady) return;
      setApplePending(true);
      void appleReady().then(credential => callbacks.current.onCredential(credential)).catch(error => callbacks.current.onError(error)).finally(() => setApplePending(false));
    }} title={!appleConfigured ? 'Вход через Apple пока не подключён' : undefined}>
      {applePending ? <span className="spinner" /> : <svg width="18" height="21" viewBox="0 0 18 21" fill="currentColor" aria-hidden="true"><path d="M12.4 3.3c.7-.9 1.2-2 1.1-3.1-1 .1-2.2.7-2.9 1.5-.7.8-1.3 1.9-1.1 3 1.1.1 2.2-.6 2.9-1.4ZM15 11.1c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.7-1.9-1.6-.2-3 .9-3.8.9-.8 0-2-1-3.3-.9C4.5 5.5 2.8 6.5 1.9 8.1c-1.8 3.1-.5 7.7 1.2 10.2.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.3.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.3Z" /></svg>}
      Продолжить с Apple{(!appleConfigured || appleFailed) && <span className="auth-provider-status">Недоступен</span>}
    </button>
  </div><div className="auth-divider"><span />или с электронной почтой<span /></div></>;
}

function passwordError(password: string): string | undefined {
  return [...password].length < 8 || !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password) || !/\p{Nd}/u.test(password)
    ? 'Нужно от 8 символов, заглавная и строчная буквы и цифра.' : undefined;
}

export function AuthScreen({ onAuthenticated, onDemo }: { onAuthenticated: (session: AuthSession) => void; onDemo: () => void }) {
  const [saved] = useState(savedRegistration);
  const [mode, setMode] = useState<Mode>(saved ? 'verify' : 'login');
  const [email, setEmail] = useState(saved?.email || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(saved?.challenge || null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [now, setNow] = useState(Date.now());
  const [retryAt, setRetryAt] = useState(0);
  const [resetResendAt, setResetResendAt] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailId = useId();
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  useEffect(() => { titleRef.current?.focus(); }, [mode]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const resendAt = mode === 'verify' ? Date.parse(challenge?.resend_available_at || '') : resetResendAt;
  const resendSeconds = Math.max(0, Math.ceil(((Number.isFinite(resendAt) ? resendAt : 0) - now) / 1000), retrySeconds);
  const switchMode = (next: Mode) => {
    if (busyRef.current) return;
    setMode(next); setError(''); setNotice(''); setErrors({}); setOtp(''); setPassword(''); setConfirmation('');
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.retryAfter) setRetryAt(Date.now() + cause.retryAfter * 1000);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const saveChallenge = (next: OtpChallenge) => {
    setChallenge(next);
    try { sessionStorage.setItem(registrationKey, JSON.stringify({ email: email.trim().toLowerCase(), challenge: next })); } catch { /* Private browsing may disallow storage. */ }
  };
  const finish = (session: AuthSession) => {
    try { sessionStorage.removeItem(registrationKey); } catch { /* Authentication also works without storage. */ }
    setPassword(''); setConfirmation(''); onAuthenticated(session);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Errors = {};
    if (['login', 'register', 'forgot'].includes(mode) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Введите корректный адрес электронной почты.';
    if (mode === 'login' && !password) nextErrors.password = 'Введите пароль.';
    if (mode === 'register' || mode === 'reset') {
      const invalidPassword = passwordError(password);
      if (invalidPassword) nextErrors.password = invalidPassword;
      if (password !== confirmation || !confirmation) nextErrors.confirmation = 'Пароли должны совпадать.';
    }
    if ((mode === 'verify' || mode === 'reset') && !/^\d{6}$/.test(otp)) nextErrors.otp = 'Введите все 6 цифр из письма.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    void run(async () => {
      const address = email.trim().toLowerCase();
      if (mode === 'login') finish(await api<AuthSession>('/auth/login', { method: 'POST', body: { email: address, password } }));
      if (mode === 'register') {
        const next = await api<OtpChallenge>('/auth/preregister', { method: 'POST', body: { email: address, password } });
        saveChallenge(next); setMode('verify'); setOtp(''); setPassword(''); setConfirmation('');
      }
      if (mode === 'verify' && challenge) finish(await api<AuthSession>('/auth/confirm', { method: 'POST', body: { challenge_id: challenge.challenge_id, otp } }));
      if (mode === 'forgot') {
        await api('/auth/forgot-password', { method: 'POST', body: { email: address } });
        setResetResendAt(Date.now() + 60000); setMode('reset'); setOtp('');
      }
      if (mode === 'reset') {
        await api('/auth/reset-password', { method: 'POST', body: { email: address, code: otp, new_password: password } });
        setMode('success'); setPassword(''); setConfirmation(''); setOtp('');
      }
    });
  };
  const resend = () => void run(async () => {
    if (mode === 'verify' && challenge) saveChallenge(await api<OtpChallenge>('/auth/resend', { method: 'POST', body: { challenge_id: challenge.challenge_id } }));
    if (mode === 'reset') { await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim().toLowerCase() } }); setResetResendAt(Date.now() + 60000); }
    setOtp(''); setNotice('Запрос отправлен. Проверьте входящие и папку «Спам».');
  });
  const headings: Record<Mode, string> = { login: 'С возвращением', register: 'Начнём с чистого листа', verify: 'Проверьте почту', forgot: 'Забыли пароль?', reset: 'Новый пароль', success: 'Всё получилось' };
  const subtitles: Record<Mode, ReactNode> = {
    login: 'Ваши планы уже ждут. Войдите, чтобы продолжить.', register: 'Создайте аккаунт и соберите свой день воедино.',
    verify: <>Мы отправили 6-значный код на <strong>{email.trim()}</strong>. Введите его ниже.</>,
    forgot: 'Укажите почту вашего аккаунта. Мы поможем восстановить доступ.',
    reset: <>Если аккаунт с паролем на <strong>{email.trim()}</strong> существует, на него отправлен код.</>,
    success: 'Пароль обновлён. Войдите с новым паролем — ваши планы на месте.',
  };
  const primaryLabels: Record<Mode, string> = { login: 'Войти', register: 'Создать аккаунт', verify: 'Подтвердить почту', forgot: 'Отправить код', reset: 'Сохранить пароль', success: 'Вернуться ко входу' };
  return <AuthShell><div className="auth-form-wrap">
    {['verify', 'forgot', 'reset'].includes(mode) && <button type="button" className="auth-back" disabled={busy} onClick={() => switchMode(mode === 'verify' ? 'register' : 'login')}><ArrowLeft size={16} />{mode === 'verify' ? 'Изменить почту' : 'Вернуться ко входу'}</button>}
    <div className={`auth-form-icon ${mode === 'success' ? 'auth-form-icon-success' : ''}`}>{mode === 'verify' ? <Mail /> : mode === 'success' ? <CheckCheck /> : ['forgot', 'reset'].includes(mode) ? <LockKeyhole /> : <Leaf />}</div>
    <div className="eyebrow auth-welcome-label">{mode === 'register' ? 'ПРИВЕТ, ЭТО LIFE HUB' : mode === 'login' ? 'ХОРОШО, ЧТО ВЫ ЗДЕСЬ' : 'ВАШ АККАУНТ'}</div>
    <h2 className="auth-form-title" tabIndex={-1} ref={titleRef}>{headings[mode]}</h2><p className="auth-form-subtitle">{subtitles[mode]}</p>
    {(mode === 'login' || mode === 'register') && <SocialButtons busy={busy} onError={cause => setError(errorMessage(cause))} onCredential={credential => { void run(async () => finish(await api<AuthSession>('/auth/social', { method: 'POST', body: credential }))); }} />}
    {error && <div className="auth-alert auth-alert-error" role="alert">{error}</div>}{notice && <div className="auth-alert" role="status">{notice}</div>}
    {mode === 'success' ? <button type="button" className="button primary auth-submit" onClick={() => switchMode('login')}>Вернуться ко входу<ArrowRight size={17} /></button> : <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
      {['login', 'register', 'forgot'].includes(mode) && <div className="field"><label htmlFor={emailId}>Электронная почта</label><input id={emailId} className="input" type="email" autoComplete="email" inputMode="email" value={email} placeholder="you@example.com" maxLength={320} disabled={busy} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${emailId}-error` : undefined} />{errors.email && <span className="field-error" id={`${emailId}-error`}>{errors.email}</span>}</div>}
      {['verify', 'reset'].includes(mode) && <OtpInput value={otp} onChange={setOtp} error={errors.otp} disabled={busy} />}
      {['login', 'register', 'reset'].includes(mode) && <PasswordField value={password} onChange={setPassword} label={mode === 'reset' ? 'Новый пароль' : 'Пароль'} error={errors.password} hint={mode !== 'login'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} />}
      {['register', 'reset'].includes(mode) && <PasswordField value={confirmation} onChange={setConfirmation} label="Повторите пароль" error={errors.confirmation} autoComplete="new-password" disabled={busy} />}
      {mode === 'login' && <div className="auth-forgot-row"><span><LockKeyhole size={12} /> Защищённый вход</span><button type="button" disabled={busy} onClick={() => switchMode('forgot')}>Забыли пароль?</button></div>}
      <button type="submit" className="button primary auth-submit" disabled={busy || retrySeconds > 0}>{busy ? <><span className="spinner" />Подождите…</> : retrySeconds ? `Повторить через ${retrySeconds} с` : <>{primaryLabels[mode]}<ArrowRight size={17} /></>}</button>
    </form>}
    {['verify', 'reset'].includes(mode) && <div className="auth-resend"><span>Письмо не пришло?</span><button type="button" disabled={busy || resendSeconds > 0} onClick={resend}>{resendSeconds ? `Отправить снова через ${resendSeconds} с` : 'Отправить код ещё раз'}</button><small>Код действует 10 минут. Проверьте папку «Спам».</small></div>}
    {(mode === 'login' || mode === 'register') && <><p className="auth-mode-switch">{mode === 'login' ? 'Ещё нет аккаунта?' : 'Уже есть аккаунт?'} <button type="button" disabled={busy} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</button></p>
      <div className="auth-demo"><button type="button" onClick={onDemo} disabled={busy}>Сначала осмотреться<ChevronRight size={15} /></button><span>Демо с примерами, без регистрации</span></div></>}
  </div></AuthShell>;
}

function browserTimezone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }

export function Onboarding({ user, onComplete, onLogout }: { user: User; onComplete: (user: User) => void; onLogout: () => void }) {
  const [modules,setModules]=useState<string[]>(user.free_modules.length?user.free_modules:['planning','goals_habits','health']);
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone && user.timezone !== 'UTC' ? user.timezone : browserTimezone());
  const [plan, setPlan] = useState<'free' | 'trial'>(user.plan === 'trial' ? 'trial' : 'free');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const nameId = useId(); const timezoneId = useId();
  const timezones = Array.from(new Set([timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')])).sort();
  const trialUsed = Boolean(user.trial_ends) && user.plan !== 'trial';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    if (!name.trim()) { setNameError('Как к вам обращаться?'); return; }
    if(!user.free_modules.length&&modules.length!==3){setError('Выберите ровно три модуля для Free.');return;}
    setNameError(''); setError(''); busyRef.current = true; setBusy(true);
    try {
      const updated = await api<User>('/users/me', { method: 'PATCH', body: {
        name: name.trim(), timezone, onboarding_completed: true,
        ...(!user.free_modules.length ? { free_modules: modules } : {}),
        ...(user.plan !== 'pro' ? { plan } : {}),
      } });
      onComplete(updated);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <AuthShell onboarding><div className="auth-form-wrap auth-onboarding-wrap">
    <div className="auth-onboarding-top"><span className="eyebrow">ЗНАКОМИМСЯ</span><span>Один маленький шаг</span></div>
    <div className="auth-form-icon"><Sparkles /></div><h2 className="auth-form-title">Ваше пространство</h2><p className="auth-form-subtitle">Несколько деталей — и можно строить планы.</p>
    {error && <div className="auth-alert auth-alert-error" role="alert">{error}</div>}
    <form className="auth-form" onSubmit={event => { void submit(event); }} noValidate aria-busy={busy}>
      <div className="field"><label htmlFor={nameId}>Как вас зовут?</label><input id={nameId} className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Ваше имя" autoComplete="given-name" maxLength={50} disabled={busy} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${nameId}-error` : undefined} autoFocus />{nameError && <span className="field-error" id={`${nameId}-error`}>{nameError}</span>}</div>
      <div className="field"><label htmlFor={timezoneId}>Часовой пояс</label><div className="auth-timezone-wrap"><Globe2 size={17} /><select id={timezoneId} className="input" value={timezone} disabled={busy} onChange={event => setTimezone(event.target.value)}>{timezones.map(zone => <option value={zone} key={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></div><span className="auth-field-hint">Чтобы встречи и напоминания приходили вовремя.</span></div>
      {!user.free_modules.length ? <fieldset className="auth-plan-fieldset"><legend>Ваши три модуля Free · {modules.length} / 3</legend><p className="auth-field-hint">Выбор сохраняется. В Pro доступны все пять модулей.</p>{[['planning','Планирование'],['goals_habits','Цели и привычки'],['health','Здоровье'],['finance','Финансы'],['books','Книги и дневник']].map(([key,label])=><label className={`auth-plan-option${modules.includes(key)?' selected':''}`} key={key}><input type="checkbox" checked={modules.includes(key)} disabled={busy||(!modules.includes(key)&&modules.length===3)} onChange={()=>setModules(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key])}/><strong>{label}</strong></label>)}</fieldset> : <p className="auth-field-hint">Выбранные ранее бесплатные модули сохранятся. В Pro доступны все разделы.</p>}
      {user.plan !== 'pro' && <fieldset className="auth-plan-fieldset"><legend>Выберите, как начать</legend>
        <label className={`auth-plan-option${plan === 'free' ? ' selected' : ''}`}><input type="radio" name="start-plan" value="free" checked={plan === 'free'} onChange={() => setPlan('free')} disabled={busy} /><span><strong>Бесплатно<span>Free</span></strong><small>Базовые возможности трёх выбранных модулей.</small></span></label>
        <label className={`auth-plan-option${plan === 'trial' ? ' selected' : ''}${trialUsed ? ' unavailable' : ''}`}><input type="radio" name="start-plan" value="trial" checked={plan === 'trial'} onChange={() => setPlan('trial')} disabled={busy || trialUsed} /><span><strong>Попробовать Pro<span>72 часа</span></strong><small>{trialUsed ? 'Пробный период уже использован.' : 'Все модули, история и расширенные возможности.'}</small></span><Sparkles size={17} /></label>
        <p className="auth-field-hint">{plan === 'trial' ? 'Пробный период начнётся после нажатия кнопки. Через 72 часа — Free, без автоматического списания.' : 'Пробный период не запускается автоматически.'}</p>
      </fieldset>}
      <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner" />Сохраняем…</> : <>Открыть Life Hub<ArrowRight size={17} /></>}</button>
    </form><button type="button" className="auth-onboarding-logout" disabled={busy} onClick={onLogout}>Выйти из аккаунта</button>
  </div></AuthShell>;
}
