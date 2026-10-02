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
const listeners = new Set<() => void>();
let loaded = false;
let session: AuthSession | null = null;
let epoch = 0;
let refreshFlight: { epoch: number; promise: Promise<void> } | null = null;

function validTokens(value: unknown): value is TokenPair {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<TokenPair>;
  return typeof tokens.access_token === 'string' && !!tokens.access_token &&
    typeof tokens.refresh_token === 'string' && !!tokens.refresh_token &&
    tokens.token_type === 'bearer' && typeof tokens.expires_in === 'number';
}

export function getSession(): AuthSession | null {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const saved = raw ? JSON.parse(raw) as AuthSession : null;
      if (saved?.user?.id && validTokens(saved.tokens)) session = saved;
    } catch { /* Storage can be disabled; the current tab still works in memory. */ }
  }
  return session;
}

function publish(): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* Never fall back to persistent storage for real credentials. */ }
  for (const listener of listeners) listener();
}

export function setSession(value: AuthSession): void {
  if (!value?.user?.id || !validTokens(value.tokens)) {
    throw new ApiError(502, 'invalid_response', 'Сервер вернул неполные данные входа. Попробуйте ещё раз.');
  }
  const previous = getSession();
  if (!previous || previous.user.id !== value.user.id || Boolean(previous.demo) !== Boolean(value.demo) ||
    previous.tokens.access_token !== value.tokens.access_token || previous.tokens.refresh_token !== value.tokens.refresh_token) epoch += 1;
  loaded = true;
  session = value;
  publish();
}

export function clearSession(): void {
  epoch += 1;
  loaded = true;
  session = null;
  publish();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function startDemo(): AuthSession {
  const value = createDemoSession();
  setSession(value);
  return value;
}

export function isDemo(): boolean { return getSession()?.demo === true; }

const messages: Record<string, string> = {
  invalid_credentials: 'Неверная почта или пароль.',
  invalid_current_password: 'Текущий пароль указан неверно.',
  invalid_otp: 'Код не подошёл. Проверьте шесть цифр из последнего письма.',
  invalid_token: 'Код не подошёл. Проверьте последнее письмо или запросите новый код.',
  otp_expired: 'Срок действия кода истёк. Запросите новый код.',
  token_expired: 'Срок действия кода истёк. Запросите новый код.',
  otp_locked: 'Попытки ввода кода закончились. Начните заново.',
  registration_expired: 'Срок подтверждения регистрации истёк. Начните регистрацию заново.',
  challenge_not_found: 'Подтверждение не найдено. Начните регистрацию заново.',
  email_in_use: 'Эта почта уже зарегистрирована. Войдите или восстановите пароль.',
  rate_limit: 'Слишком много попыток. Немного подождите и повторите.',
  cooldown_or_limit: 'Нужно немного подождать перед следующей попыткой.',
  unauthorized: 'Войдите в аккаунт, чтобы продолжить.',
  invalid_access: 'Сессия истекла. Войдите снова.',
  invalid_expired_or_reused_refresh: 'Сессия истекла. Войдите снова.',
  invalid_refresh: 'Сессия истекла. Войдите снова.',
  account_unavailable: 'Аккаунт недоступен.',
  provider_unavailable: 'Сервис не настроен или временно недоступен. Проверьте настройки подключения на сервере.',
  invalid_provider_token: 'Не удалось подтвердить вход через сервис. Попробуйте войти ещё раз.',
  identity_conflict: 'Этот аккаунт сервиса уже связан с другим пользователем.',
  version_conflict: 'Запись уже изменилась. Обновите данные и повторите действие.',
  not_found: 'Запись не найдена. Возможно, она уже удалена.',
  pro_required: 'Эта возможность доступна с Pro или во время пробного периода.',
  module_locked: 'Этот модуль не входит в ваш выбор Free. Он доступен в Pro.',
  invalid_date: 'Проверьте дату: запись не может быть в будущем или раньше начала истории.',
  unscheduled_day: 'Привычка не запланирована на этот день недели.',
  habit_archived: 'Сначала восстановите привычку из архива.',
  invalid_password: 'Текущий пароль указан неверно.',
  payment_exceeds_debt: 'Сумма погашения больше остатка долга.',
  debt_has_payments: 'После погашений нельзя менять валюту и направление долга.',
  duplicate_budget: 'Бюджет для этой категории, валюты и месяца уже есть.',
  catalog_unavailable: 'Каталог книг сейчас недоступен. Книгу можно добавить вручную.',
  export_not_ready: 'Копия данных ещё готовится.',
  export_expired: 'Срок скачивания истёк. Закажите новую копию.',
  invalid_image: 'Нужно фото JPG, PNG или WebP до 650 КБ и 16 мегапикселей.',
  ai_limit: 'Лимит запросов к ИИ на сегодня исчерпан.',
  system_list_locked: 'Список «Покупки» нельзя переименовать или удалить.',
  already_completed: 'Задача уже выполнена. Обновите список.',
  not_completed: 'Задача уже открыта. Обновите список.',
  occurrence_required: 'Выберите конкретное повторение в календаре.',
  invalid_occurrence: 'Это повторение больше не существует. Обновите календарь.',
  invalid_rrule: 'Проверьте правило повторения и дату начала.',
  invalid_local_time: 'Время не соответствует выбранному часовому поясу.',
  recurrence_too_complex: 'Правило повторения слишком сложное. Упростите его.',
  invalid_or_large_range: 'Выберите период длительностью не больше 93 дней.',
  sync_conflict: 'Внешний календарь разрешает только просмотр этого события.',
  immutable_free_modules: 'Набор бесплатных модулей уже выбран.',
  trial_already_used: 'Пробный период уже был использован.',
  plan_managed_by_billing: 'Изменить платный тариф здесь нельзя.',
  password_account_required: 'Изменение почты доступно для аккаунтов с паролем.',
  model_error: 'ИИ не смог обработать запрос. Попробуйте сформулировать его иначе.',
  ai_quota_exceeded: 'Лимит запросов к ИИ на сегодня исчерпан.',
  internal_error: 'На сервере произошла ошибка. Попробуйте позже.',
  validation_error: 'Проверьте заполненные поля и даты.',
  invalid_calendar_state: 'Ссылка подключения уже использована или устарела. Начните подключение заново в настройках календаря.',
  invalid_authorization_code: 'Google не принял код подключения. Начните подключение заново в настройках календаря.',
  calendar_reauth_required: 'Google отклонил доступ к календарю. Подключите календарь заново и подтвердите разрешения.',
  calendar_permissions_required: 'Не предоставлены необходимые разрешения календаря. Подключите Google заново и разрешите доступ к событиям и списку календарей.',
  calendar_api_disabled: 'Google Calendar API не включён для приложения. Сообщите об этом администратору Life Hub.',
  calendar_oauth_misconfigured: 'Настройки подключения Google Calendar требуют исправления. Сообщите администратору Life Hub.',
  calendar_offline_access_required: 'Google не предоставил постоянный доступ к календарю. Начните подключение заново и подтвердите разрешения.',
  calendar_write_access_required: 'У выбранного аккаунта нет прав на изменение основного календаря.',
  provider_rate_limited: 'Google временно ограничил запросы. Подождите немного и повторите подключение.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (messages[error.code]) return messages[error.code];
    if (error.code === 'ambiguous_command' || error.code.startsWith('demo_') ||
      ['network_error', 'session_changed', 'session_expired', 'invalid_response'].includes(error.code)) return error.message;
    if (error.status === 429) return messages.rate_limit;
    if (error.status >= 500) return 'Сервис временно недоступен. Попробуйте позже.';
    if (error.status === 403) return 'Недостаточно прав для этого действия.';
    return error.message && /[А-Яа-яЁё]/.test(error.message) ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
  }
  if (error instanceof Error && error.name === 'AbortError') return 'Запрос отменён.';
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.';
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
      envelope?.error?.message || 'Не удалось выполнить запрос.',
      Array.isArray(envelope?.error?.details) ? envelope.error.details : [], retrySeconds(response.headers.get('Retry-After')));
  }
  if (text && body === undefined) {
    throw new ApiError(502, 'invalid_response', 'Сервер вернул неожиданный ответ. Проверьте подключение к API.');
  }
  return body;
}

async function request(path: string, options: ApiOptions, token?: string): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET', headers, signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin', redirect: 'error',
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'network_error', 'Нет связи с сервером. Проверьте соединение и запуск Life Hub.');
  }
  return decode(response);
}

const changedSession = () => new ApiError(409, 'session_changed', 'Аккаунт изменился. Повторите действие в текущей сессии.');

async function refresh(expectedEpoch: number): Promise<void> {
  if (epoch !== expectedEpoch || !session || session.demo) throw changedSession();
  if (refreshFlight?.epoch === expectedEpoch) return refreshFlight.promise;
  const refreshToken = session.tokens.refresh_token;
  const promise = (async () => {
    try {
      const tokens = await request('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } });
      if (epoch !== expectedEpoch || !session) throw changedSession();
      if (!validTokens(tokens)) throw new ApiError(502, 'invalid_response', 'Не удалось обновить сессию. Попробуйте ещё раз.');
      session = { ...session, tokens };
      publish();
    } catch (error) {
      if (epoch !== expectedEpoch) throw changedSession();
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        throw new ApiError(401, 'session_expired', 'Сессия истекла. Войдите снова.');
      }
      throw error;
    }
  })();
  const flight = { epoch: expectedEpoch, promise };
  refreshFlight = flight;
  try { await promise; } finally { if (refreshFlight === flight) refreshFlight = null; }
}

export async function api<T>(rawPath: string, options: ApiOptions = {}): Promise<T> {
  const path = rawPath.replace(/^\/api\/v1(?=\/)/, '');
  if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError(400, 'invalid_path', 'Неверный адрес запроса.');
  options.signal?.throwIfAborted();
  const current = getSession();
  const expectedEpoch = epoch;
  if (current?.demo) {
    try {
      const result = await demoRequest(path, options, current.user);
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
  const token = current?.tokens.access_token;
  try {
    const result = await request(path, options, token);
    if (epoch !== expectedEpoch) throw changedSession();
    return result as T;
  } catch (error) {
    if (epoch !== expectedEpoch) throw changedSession();
    if (!accessFailure(error) || !current) throw error;
    // A late 401 can arrive after another request has already rotated tokens.
    if (session?.tokens.access_token === token) await refresh(expectedEpoch);
    options.signal?.throwIfAborted();
    if (epoch !== expectedEpoch || !session) throw changedSession();
    const retryToken = session.tokens.access_token;
    try {
      const result = await request(path, options, retryToken);
      if (epoch !== expectedEpoch) throw changedSession();
      return result as T;
    } catch (retryError) {
      if (epoch !== expectedEpoch) throw changedSession();
      if (accessFailure(retryError) && session?.tokens.access_token === retryToken) clearSession();
      throw retryError;
    }
  }
}
