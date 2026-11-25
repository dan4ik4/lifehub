import { t } from './language';
import {Capacitor} from '@capacitor/core';
import type { AuthSession, TokenPair } from './types';
import { createDemoSession, demoRequest, DemoError } from './demo';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ErrorDetail { field?: string | null; message: string; type?: string }

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: ErrorDetail[] = [],
    public retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const SESSION_KEY = 'lifehub.session.v1';
const sharedReads = new Map<string, { promise: Promise<unknown>; expires: number }>();
const listeners = new Set<() => void>();
let loaded = false;
let session: AuthSession | null = null;
let epoch = 0;
let refreshFlight: { epoch: number; promise: Promise<void> } | null = null;
let persistent = true;
let storageSnapshot: string | null = null;

function validTokens(value: unknown): value is AuthSession['tokens'] {
  if (!value || typeof value !== 'object') return false;
  if ('token_type' in value && value.token_type === 'cookie') {
    return 'session_id' in value && typeof value.session_id === 'string' && !!value.session_id &&
      'rotation_id' in value && typeof value.rotation_id === 'string' && !!value.rotation_id &&
      'expires_at' in value && typeof value.expires_at === 'number' && Number.isFinite(value.expires_at) &&
      !('access_token' in value) && !('refresh_token' in value);
  }
  const tokens = value as Partial<TokenPair>;
  return typeof tokens.access_token === 'string' && !!tokens.access_token &&
    typeof tokens.refresh_token === 'string' && !!tokens.refresh_token &&
    tokens.token_type === 'bearer' && typeof tokens.expires_in === 'number';
}

const rotation = (tokens: AuthSession['tokens']) =>
  tokens.token_type === 'cookie' ? tokens.rotation_id : tokens.refresh_token;

function readSession(raw: string | null): AuthSession | null {
  try {
    const saved = raw ? JSON.parse(raw) as AuthSession : null;
    return saved?.user?.id && validTokens(saved.tokens) ? saved : null;
  } catch { return null; }
}

// Cache the parsed object: useSyncExternalStore needs a stable snapshot.
function syncSession(): void {
  if (!persistent || session?.demo) return;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === storageSnapshot) return;
    storageSnapshot = raw;
    const saved = readSession(raw);
    const next = saved?.demo ? null : saved;
    if (session?.user.id !== next?.user.id ||
      (session?.tokens.token_type === 'cookie' && next?.tokens.token_type === 'cookie' &&
       session.tokens.session_id !== next.tokens.session_id)) {
      epoch += 1;
      sharedReads.clear();
    }
    session = next;
  } catch { /* Keep the in-memory session when storage is unavailable. */ }
}

export function getSession(): AuthSession | null {
  if (!loaded) {
    loaded = true;
    try {
      storageSnapshot = localStorage.getItem(SESSION_KEY);
      const saved = readSession(storageSnapshot);
      if (saved && !saved.demo) session = saved;
    } catch { persistent = false; }
    try {
      const legacy = readSession(sessionStorage.getItem(SESSION_KEY));
      if (legacy?.demo) session = legacy;
      else if (!session && legacy) { session = legacy; publish(); }
      if (!session?.demo && persistent) sessionStorage.removeItem(SESSION_KEY);
    } catch { /* The current session still works in memory. */ }
  }
  syncSession();
  return session;
}

function publish(): void {
  try {
    storageSnapshot = session && !session.demo ? JSON.stringify(session) : null;
    if (storageSnapshot) localStorage.setItem(SESSION_KEY, storageSnapshot);
    else localStorage.removeItem(SESSION_KEY);
  } catch { persistent = false; }
  try {
    if (session && (session.demo || !persistent)) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* Storage can be disabled; the current tab still works in memory. */ }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SESSION_KEY) return;
  const previous = session;
  syncSession();
  if (previous !== session) for (const listener of listeners) listener();
}

export function setSession(value: AuthSession): void {
  if (!value?.user?.id || !validTokens(value.tokens) ||
      (!value.demo && !Capacitor.isNativePlatform() && value.tokens.token_type !== 'cookie')) {
    throw new ApiError(502, 'invalid_response', t("Сервер вернул неполные данные входа. Попробуйте ещё раз."));
  }
  const previous = getSession();
  if (!previous || previous.user.id !== value.user.id || Boolean(previous.demo) !== Boolean(value.demo) ||
    rotation(previous.tokens) !== rotation(value.tokens)) {
    epoch += 1;
    sharedReads.clear();
  }
  loaded = true;
  session = value;
  publish();
}

export function clearSession(): void {
  epoch += 1;
  sharedReads.clear();
  loaded = true;
  session = null;
  publish();
}

export function subscribeSession(listener: () => void): () => void {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function startDemo(): AuthSession {
  const value = createDemoSession();
  setSession(value);
  return value;
}

export function isDemo(): boolean { return getSession()?.demo === true; }

export function getSessionGeneration(): number {
  getSession();
  return epoch;
}

export async function logoutSession(signal = AbortSignal.timeout(5000)): Promise<void> {
  const current = getSession();
  if (!current || current.demo) return;
  const expectedEpoch = epoch;
  const revoke = async () => {
    const latest = getSession();
    signal.throwIfAborted();
    if (!latest || epoch !== expectedEpoch) throw changedSession();
    await request('/auth/logout', { method: 'POST', body: { refresh_token: latest.tokens.refresh_token }, signal }, latest.tokens);
  };
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request('lifehub.auth.refresh', {signal}, revoke);
  } else await revoke();
}

// Each subscriber can stop waiting without aborting another mounted component's read.
function forSubscriber<T>(result: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return result;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function invalidateSharedReads(): void {
  sharedReads.clear();
}

export async function api<T>(rawPath: string, options: ApiOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const path = rawPath.replace(/^\/api\/v1(?=\/)/, '');
  const endpoint = path.split('?')[0];
  const current = getSession(), expectedEpoch = epoch;
  if (options.method && options.method !== 'GET') {
    sharedReads.clear();
    const result = await perform<T>(path, options);
    sharedReads.clear();
    return result;
  }
  // Several widgets can mount in succession as their parent loads. Keep their
  // reads briefly, then let a fresh visit or an explicit refresh fetch again.
  const retain = endpoint === '/users/me/avatar' || endpoint === '/users/me/assistant-preferences';
  const summary = ['/finance/overview', '/health/summary', '/books/stats'].includes(endpoint);
  if (!current || current.demo || options.headers || (!retain && !summary)) return perform<T>(path, options);
  const query = new URLSearchParams(path.split('?')[1]);
  query.sort();
  const key = expectedEpoch + ':' + endpoint + '?' + query;
  const now = Date.now();
  for (const [cachedKey, previous] of sharedReads) {
    if (previous.expires <= now) sharedReads.delete(cachedKey);
  }
  let entry = sharedReads.get(key);
  if (!entry) {
    const next = { promise: perform<T>(path, { ...options, signal: undefined }), expires: Infinity };
    entry = next;
    sharedReads.set(key, next);
    next.promise.then(() => {
      next.expires = Date.now() + (retain ? 30_000 : 5_000);
    }, () => { if (sharedReads.get(key) === next) sharedReads.delete(key); });
  }
  const result = await forSubscriber(entry.promise, options.signal);
  getSession();
  if (expectedEpoch !== epoch) throw changedSession();
  return result as T;
}

const messages: Record<string, string> = {
  book_already_on_shelf: t("Эта книга уже на вашей полке."),
  voice_not_configured: t("Распознавание голоса не подключено на этом сервере. Требуется ключ OpenAI."),
  transcription_failed: t("Не удалось распознать запись. Попробуйте ещё раз."),
  invalid_audio: t("Запись повреждена или слишком большая. Запишите голос заново."),
  empty_audio: t("Не удалось услышать речь. Попробуйте записать ещё раз."),
  voice_too_long: t("Слишком длинная запись. Запишите более короткое сообщение."),
  invalid_credentials: t("Неверная почта или пароль."),
  invalid_current_password: t("Текущий пароль указан неверно."),
  invalid_otp: t("Код не подошёл. Проверьте шесть цифр из последнего письма."),
  invalid_token: t("Код не подошёл. Проверьте последнее письмо или запросите новый код."),
  otp_expired: t("Срок действия кода истёк. Запросите новый код."),
  token_expired: t("Срок действия кода истёк. Запросите новый код."),
  otp_locked: t("Попытки ввода кода закончились. Начните заново."),
  registration_expired: t("Срок подтверждения регистрации истёк. Начните регистрацию заново."),
  challenge_not_found: t("Подтверждение не найдено. Начните регистрацию заново."),
  email_in_use: t("Эта почта уже зарегистрирована. Войдите или восстановите пароль."),
  rate_limit: t("Слишком много попыток. Немного подождите и повторите."),
  cooldown_or_limit: t("Нужно немного подождать перед следующей попыткой."),
  unauthorized: t("Войдите в аккаунт, чтобы продолжить."),
  invalid_access: t("Сессия истекла. Войдите снова."),
  invalid_expired_or_reused_refresh: t("Сессия истекла. Войдите снова."),
  invalid_refresh: t("Сессия истекла. Войдите снова."),
  account_unavailable: t("Аккаунт недоступен."),
  provider_unavailable: t("Сервис не настроен или временно недоступен. Проверьте настройки подключения на сервере."),
  invalid_provider_token: t("Не удалось подтвердить вход через сервис. Попробуйте войти ещё раз."),
  identity_conflict: t("Этот аккаунт сервиса уже связан с другим пользователем."),
  version_conflict: t("Запись уже изменилась. Обновите данные и повторите действие."),
  not_found: t("Запись не найдена. Возможно, она уже удалена."),
  pro_required: t("Эта возможность доступна с Pro или во время пробного периода."),
  module_locked: t("Этот модуль не входит в ваш выбор Free. Он доступен в Pro."),
  invalid_date: t("Проверьте дату: запись не может быть в будущем или раньше начала истории."),
  unscheduled_day: t("Привычка не запланирована на этот день недели."),
  habit_archived: t("Сначала восстановите привычку из архива."),
  invalid_password: t("Текущий пароль указан неверно."),
  payment_exceeds_debt: t("Сумма погашения больше остатка долга."),
  debt_has_payments: t("После погашений нельзя менять валюту и направление долга."),
  duplicate_budget: t("Бюджет для этой категории, валюты и месяца уже есть."),
  catalog_unavailable: t("Каталог книг сейчас недоступен. Книгу можно добавить вручную."),
  export_not_ready: t("Копия данных ещё готовится."),
  export_expired: t("Срок скачивания истёк. Закажите новую копию."),
  invalid_image: t("Не удалось загрузить фото. Выберите другое изображение."),
  pdf_too_large: t("Файл PDF больше 15 МБ. Выберите выписку за меньший период."),
  pdf_too_many_pages: t("В PDF больше 30 страниц. Выберите выписку за меньший период."),
  pdf_content_too_large: t("В PDF слишком много текста для одного разбора. Выберите выписку за меньший период."),
  pdf_extraction_timeout: t("Чтение PDF заняло слишком много времени. Выберите выписку за меньший период."),
  pdf_encrypted: t("PDF защищён паролем. Сохраните копию без пароля и загрузите её."),
  pdf_no_text: t("На одной из страниц нет читаемого текста. Нужен PDF из банка с выделяемым текстом; сканы пока не поддерживаются."),
  ai_limit: t("Лимит запросов к ИИ на сегодня исчерпан."),
  system_list_locked: t("Список «Покупки» нельзя переименовать или удалить."),
  already_completed: t("Задача уже выполнена. Обновите список."),
  not_completed: t("Задача уже открыта. Обновите список."),
  occurrence_required: t("Выберите конкретное повторение в календаре."),
  invalid_occurrence: t("Это повторение больше не существует. Обновите календарь."),
  invalid_rrule: t("Проверьте правило повторения и дату начала."),
  invalid_local_time: t("Время не соответствует выбранному часовому поясу."),
  recurrence_too_complex: t("Правило повторения слишком сложное. Упростите его."),
  invalid_or_large_range: t("Выберите период длительностью не больше 93 дней."),
  sync_conflict: t("Внешний календарь разрешает только просмотр этого события."),
  immutable_free_modules: t("Набор бесплатных модулей уже выбран."),
  trial_already_used: t("Пробный период уже был использован."),
  plan_managed_by_billing: t("Изменить платный тариф здесь нельзя."),
  password_account_required: t("Изменение почты доступно для аккаунтов с паролем."),
  model_error: t("ИИ не смог обработать запрос. Попробуйте сформулировать его иначе."),
  ai_quota_exceeded: t("Лимит запросов к ИИ на сегодня исчерпан."),
  internal_error: t("На сервере произошла ошибка. Попробуйте позже."),
  validation_error: t("Проверьте заполненные поля и даты."),
  invalid_calendar_state: t("Ссылка подключения уже использована или устарела. Начните подключение заново в настройках календаря."),
  invalid_authorization_code: t("Google не принял код подключения. Начните подключение заново в настройках календаря."),
  calendar_reauth_required: t("Google отклонил доступ к календарю. Подключите календарь заново и подтвердите разрешения."),
  calendar_permissions_required: t("Не предоставлены необходимые разрешения календаря. Подключите Google заново и разрешите доступ к событиям и списку календарей."),
  calendar_api_disabled: t("Google Calendar API не включён для приложения. Сообщите об этом администратору Life Hub."),
  calendar_oauth_misconfigured: t("Настройки подключения Google Calendar требуют исправления. Сообщите администратору Life Hub."),
  calendar_offline_access_required: t("Google не предоставил постоянный доступ к календарю. Начните подключение заново и подтвердите разрешения."),
  calendar_write_access_required: t("У выбранного аккаунта нет прав на изменение основного календаря."),
  provider_rate_limited: t("Google временно ограничил запросы. Подождите немного и повторите подключение."),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (messages[error.code]) return messages[error.code];
    if (error.code === 'ambiguous_command' || error.code.startsWith('demo_') ||
      ['network_error', 'session_changed', 'session_expired', 'invalid_response'].includes(error.code)) return error.message;
    if (error.status === 429) return messages.rate_limit;
    if (error.status >= 500) return t("Сервис временно недоступен. Попробуйте позже.");
    if (error.status === 403) return t("Недостаточно прав для этого действия.");
    return error.message && /[А-Яа-яЁё]/.test(error.message) ? error.message : t("Не удалось выполнить действие. Попробуйте ещё раз.");
  }
  if (error instanceof Error && error.name === 'AbortError') return t("Запрос отменён.");
  if (error instanceof Error && error.message) return error.message;
  return t("Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.");
}

function retrySeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

async function decode(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (!response.ok) {
    const envelope = body as { error?: { code?: string; message?: string; details?: ErrorDetail[] } } | undefined;
    throw new ApiError(response.status, envelope?.error?.code || 'http_error',
      envelope?.error?.message || t("Не удалось выполнить запрос."),
      Array.isArray(envelope?.error?.details) ? envelope.error.details : [], retrySeconds(response.headers.get('Retry-After')));
  }
  if (text && body === undefined) {
    throw new ApiError(502, 'invalid_response', t("Сервер вернул неожиданный ответ. Проверьте подключение к API."));
  }
  return body;
}

async function request(path: string, options: ApiOptions, tokens?: AuthSession['tokens']): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (!Capacitor.isNativePlatform()) {
    headers.set('X-LifeHub-Client', 'web');
    if (tokens?.token_type === 'cookie') headers.set('X-LifeHub-Session', tokens.session_id);
  }
  if (tokens?.access_token && path !== '/auth/refresh') headers.set('Authorization', `Bearer ${tokens.access_token}`);
  let response: Response;
  try {
    response = await fetch(`${Capacitor.isNativePlatform()?'https://lifehapp.online':''}/api/v1${path}`, {
      method: options.method || 'GET', headers, signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin', redirect: 'error',
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'network_error', t("Нет связи с сервером. Проверьте соединение и запуск Life Hub."));
  }
  return decode(response);
}

const changedSession = () => new ApiError(409, 'session_changed', t("Аккаунт изменился. Повторите действие в текущей сессии."));

async function refresh(expectedEpoch: number): Promise<void> {
  if (epoch !== expectedEpoch || !session || session.demo) throw changedSession();
  if (refreshFlight?.epoch === expectedEpoch) return refreshFlight.promise;
  const original = session.tokens;
  const rotate = async () => {
    getSession();
    if (epoch !== expectedEpoch || !session || session.demo) throw changedSession();
    // Another tab may have rotated the token while we waited for its lock.
    if (rotation(session.tokens) !== rotation(original)) return;
    try {
      const tokens = await request('/auth/refresh', { method: 'POST', body: { refresh_token: original.refresh_token } }, original);
      getSession();
      if (epoch !== expectedEpoch || !session) throw changedSession();
      if (rotation(session.tokens) !== rotation(original)) return;
      if (!validTokens(tokens) || (!Capacitor.isNativePlatform() && tokens.token_type !== 'cookie')) {
        throw new ApiError(502, 'invalid_response', t("Не удалось обновить сессию. Попробуйте ещё раз."));
      }
      session = { ...session, tokens };
      publish();
    } catch (error) {
      getSession();
      if (epoch !== expectedEpoch) throw changedSession();
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        throw new ApiError(401, 'session_expired', t("Сессия истекла. Войдите снова."));
      }
      throw error;
    }
  };
  // Refresh tokens are single-use. Serialize rotation across all tabs on HTTPS.
  const promise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('lifehub.auth.refresh', rotate);
    } else await rotate();
  })();
  const flight = { epoch: expectedEpoch, promise };
  refreshFlight = flight;
  try { await promise; } finally { if (refreshFlight === flight) refreshFlight = null; }
}

async function perform<T>(rawPath: string, options: ApiOptions): Promise<T> {
  const path = rawPath.replace(/^\/api\/v1(?=\/)/, '');
  if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError(400, 'invalid_path', t("Неверный адрес запроса."));
  options.signal?.throwIfAborted();
  const current = getSession();
  const expectedEpoch = epoch;
  if (current?.demo) {
    try {
      const result = await demoRequest(path, options, current.user);
      getSession();
      if (epoch !== expectedEpoch) throw changedSession();
      if (path.split('?')[0] === '/users/me' && options.method === 'PATCH') {
        session = { ...current, user: result as AuthSession['user'] };
        publish();
      }
      return result as T;
    } catch (error) {
      if (error instanceof DemoError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }
  const pathname = path.split('?')[0];
  const authEndpoint = pathname.startsWith('/auth/');
  const protectedAuthEndpoint = ['/auth/change-email', '/auth/confirm-email-change', '/auth/change-password'].includes(pathname);
  const accessFailure = (error: unknown): error is ApiError => error instanceof ApiError && error.status === 401 &&
    (!authEndpoint || protectedAuthEndpoint) && ['unauthorized', 'invalid_access'].includes(error.code);
  const usesAccess = !authEndpoint || protectedAuthEndpoint;
  if (current && usesAccess && !Capacitor.isNativePlatform() &&
    (current.tokens.token_type === 'bearer' || current.tokens.expires_at * 1000 <= Date.now() + 30_000)) {
    // This also exchanges pre-cookie browser credentials on their first use.
    await refresh(expectedEpoch);
    options.signal?.throwIfAborted();
    if (!getSession() || epoch !== expectedEpoch) throw changedSession();
  }
  const original = session?.tokens;
  try {
    const result = await request(path, options, original);
    getSession();
    if (epoch !== expectedEpoch) throw changedSession();
    return result as T;
  } catch (error) {
    getSession();
    if (epoch !== expectedEpoch) throw changedSession();
    if (!accessFailure(error) || !current) throw error;
    // A late 401 can arrive after another request has already rotated tokens.
    if (original && session && rotation(session.tokens) === rotation(original)) await refresh(expectedEpoch);
    options.signal?.throwIfAborted();
    getSession();
    if (epoch !== expectedEpoch || !session) throw changedSession();
    const retryTokens = session.tokens;
    try {
      const result = await request(path, options, retryTokens);
      getSession();
      if (epoch !== expectedEpoch) throw changedSession();
      return result as T;
    } catch (retryError) {
      getSession();
      if (epoch !== expectedEpoch) throw changedSession();
      if (accessFailure(retryError) && session && rotation(session.tokens) === rotation(retryTokens)) clearSession();
      throw retryError;
    }
  }
}
