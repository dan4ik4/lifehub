import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, TokenPair } from './types';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const tokens = (suffix = 'old'): TokenPair => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, token_type: 'bearer', expires_in: 900, refresh_expires_in: 604800 });
const auth = (suffix = 'old'): AuthSession => ({ user: { id: `user-${suffix}`, name: 'Тест', email: 'test@example.com', email_verified: true, auth_providers: ['password'], plan: 'free', trial_ends: null, onboarding_completed: true, free_modules: ['planning'], timezone: 'UTC' }, tokens: tokens(suffix), is_new_user: false });
const response = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const unauthorized = () => response({ error: { code: 'unauthorized', message: 'Expired', details: [] } }, 401);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

let client: typeof import('./api');
let tabStorage: MemoryStorage;
let persistentStorage: MemoryStorage;

beforeEach(async () => {
  vi.resetModules();
  tabStorage = new MemoryStorage();
  persistentStorage = new MemoryStorage();
  vi.stubGlobal('sessionStorage', tabStorage);
  vi.stubGlobal('localStorage', persistentStorage);
  client = await import('./api');
});
afterEach(() => vi.unstubAllGlobals());

describe('API session lifecycle', () => {
  it('stores real credentials only for the current browser tab and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = client.subscribeSession(listener);
    client.setSession(auth());
    expect(JSON.stringify([...tabStorage.values.values()])).toContain('refresh-old');
    expect(persistentStorage.values.size).toBe(0);
    expect(client.getSession()?.user.id).toBe('user-old');
    client.clearSession();
    expect(tabStorage.values.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.setSession(auth());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('restores a valid tab session but ignores malformed persisted state', async () => {
    client.setSession(auth());
    vi.resetModules();
    const restored = await import('./api');
    expect(restored.getSession()?.tokens.refresh_token).toBe('refresh-old');
    tabStorage.setItem('lifehub.session.v1', '{not-json');
    vi.resetModules();
    expect((await import('./api')).getSession()).toBeNull();
  });

  it('shares one refresh between concurrent requests and retries both with rotated tokens', async () => {
    client.setSession(auth());
    const refresh = deferred<Response>();
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/v1/auth/refresh') return refresh.promise;
      return new Headers(options.headers).get('Authorization') === 'Bearer access-old' ? unauthorized() : response({ items: ['updated'] });
    });
    vi.stubGlobal('fetch', fetcher);
    const first = client.api('/planning/tasks');
    const second = client.api('/planning/lists');
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1));
    refresh.resolve(response(tokens('new')));
    expect(await Promise.all([first, second])).toEqual([{ items: ['updated'] }, { items: ['updated'] }]);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
    expect(client.getSession()?.tokens.refresh_token).toBe('refresh-new');
  });

  it('does not refresh twice when an old 401 arrives after token rotation', async () => {
    client.setSession(auth());
    const late = deferred<Response>();
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/refresh')) return response(tokens('new'));
      if (new Headers(options.headers).get('Authorization') === 'Bearer access-new') return response({ ok: true });
      if (url.endsWith('/lists')) return late.promise;
      return unauthorized();
    });
    vi.stubGlobal('fetch', fetcher);
    const old = client.api('/planning/lists');
    await client.api('/planning/tasks');
    late.resolve(unauthorized());
    expect(await old).toEqual({ ok: true });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
  });

  it('does not resurrect a session when an in-flight refresh finishes after logout', async () => {
    client.setSession(auth());
    const refresh = deferred<Response>();
    const fetcher = vi.fn(async (url: string) => url.endsWith('/refresh') ? refresh.promise : unauthorized());
    vi.stubGlobal('fetch', fetcher);
    const pending = client.api('/planning/tasks');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    client.clearSession();
    refresh.resolve(response(tokens('new')));
    await rejection;
    expect(client.getSession()).toBeNull();
    expect(tabStorage.values.size).toBe(0);
  });

  it('does not clear a newer account when an old refresh is rejected', async () => {
    client.setSession(auth());
    const refresh = deferred<Response>();
    const fetcher = vi.fn(async (url: string) => url.endsWith('/refresh') ? refresh.promise : unauthorized());
    vi.stubGlobal('fetch', fetcher);
    const pending = client.api('/planning/tasks');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    client.setSession(auth('other'));
    refresh.resolve(unauthorized());
    await rejection;
    expect(client.getSession()?.user.id).toBe('user-other');
  });

  it('rejects stale successful data after the user switches accounts', async () => {
    client.setSession(auth());
    const pendingResponse = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse.promise));
    const pending = client.api('/planning/tasks');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    client.setSession(auth('other'));
    pendingResponse.resolve(response({ items: ['old-private-data'] }));
    await rejection;
  });

  it('keeps in-flight planning requests valid when only profile metadata changes', async () => {
    client.setSession(auth());
    const pendingResponse = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse.promise));
    const pending = client.api('/planning/tasks');
    const previous = client.getSession()!;
    client.setSession({ ...previous, user: { ...previous.user, name: 'Новое имя', timezone: 'Europe/Warsaw' } });
    pendingResponse.resolve(response({ items: ['current-account-data'] }));
    expect(await pending).toEqual({ items: ['current-account-data'] });
    expect(client.getSession()?.user.name).toBe('Новое имя');
  });

  it('clears expired sessions after a rejected refresh', async () => {
    client.setSession(auth());
    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));
    await expect(client.api('/planning/tasks')).rejects.toMatchObject({ status: 401, code: 'session_expired' });
    expect(client.getSession()).toBeNull();
  });

  it('retains the session on transient refresh failure instead of pretending success', async () => {
    client.setSession(auth());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/refresh') ? response({ error: { code: 'provider_unavailable', message: 'Unavailable' } }, 503) : unauthorized()));
    await expect(client.api('/planning/tasks')).rejects.toMatchObject({ status: 503 });
    expect(client.getSession()?.tokens.refresh_token).toBe('refresh-old');
  });

  it('does not refresh invalid auth credentials', async () => {
    client.setSession(auth());
    const fetcher = vi.fn(async () => response({ error: { code: 'invalid_credentials', message: 'Invalid email or password', details: [] } }, 401));
    vi.stubGlobal('fetch', fetcher);
    await expect(client.api('/auth/login', { method: 'POST', body: { email: 'x@example.com', password: 'wrong' } })).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getSession()).not.toBeNull();
  });

  it.each(['/auth/change-email', '/auth/confirm-email-change', '/auth/change-password'])('refreshes an expired access token on protected auth route %s', async path => {
    client.setSession(auth());
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/refresh')) return response(tokens('new'));
      return new Headers(options.headers).get('Authorization') === 'Bearer access-old' ? unauthorized() : response({ ok: true });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await client.api(path, { method: 'POST', body: { value: 'test' } })).toEqual({ ok: true });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1);
    expect(client.getSession()?.tokens.access_token).toBe('access-new');
  });

  it('does not refresh or log out on an incorrect current password', async () => {
    client.setSession(auth());
    const fetcher = vi.fn(async () => response({ error: { code: 'invalid_current_password', message: 'The current password is invalid', details: [] } }, 401));
    vi.stubGlobal('fetch', fetcher);
    await expect(client.api('/auth/change-password', { method: 'POST', body: { current_password: 'wrong', new_password: 'another' } })).rejects.toMatchObject({ code: 'invalid_current_password' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getSession()).not.toBeNull();
  });

  it('retains a refreshed session when the retried password change rejects the current password', async () => {
    client.setSession(auth());
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/refresh')) return response(tokens('new'));
      return new Headers(options.headers).get('Authorization') === 'Bearer access-old' ? unauthorized() : response({ error: { code: 'invalid_current_password', message: 'Invalid', details: [] } }, 401);
    }));
    await expect(client.api('/auth/change-password', { method: 'POST', body: { current_password: 'wrong', new_password: 'another' } })).rejects.toMatchObject({ code: 'invalid_current_password' });
    expect(client.getSession()?.tokens.access_token).toBe('access-new');
  });
});

describe('transport and demo isolation', () => {
  it('passes version bodies, accepts empty deletion responses and preserves Retry-After', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response({ error: { code: 'rate_limit', message: 'Too many requests', details: [] } }, 429, { 'Retry-After': '42' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await client.api('/planning/tasks/1', { method: 'DELETE' })).toBeUndefined();
    await expect(client.api('/auth/resend', { method: 'POST', body: { challenge_id: 'x' } })).rejects.toMatchObject({ retryAfter: 42 });
    expect(fetcher.mock.calls[1][1].body).toBe('{"challenge_id":"x"}');
  });

  it('rejects an HTML fallback page instead of treating it as API success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>SPA fallback</html>', { status: 200 })));
    await expect(client.api('/planning/tasks')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('does not send credentials to arbitrary URLs and preserves abort errors', async () => {
    client.setSession(auth());
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(client.api('https://other.invalid/planning/tasks')).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(client.api('//other.invalid/planning/tasks')).rejects.toMatchObject({ code: 'invalid_path' });
    const controller = new AbortController(); controller.abort();
    await expect(client.api('/planning/tasks', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps demo changes away from the real backend and rejects fake integrations', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    client.startDemo();
    expect(client.isDemo()).toBe(true);
    await client.api('/planning/tasks', { method: 'POST', body: { title: 'Только в демо' } });
    await expect(client.api('/ai/chat', { method: 'POST', body: { message: 'Создай задачу' } })).rejects.toMatchObject({ code: 'demo_unavailable' });
    await expect(client.api('/auth/change-email', { method: 'POST', body: { new_email: 'real@example.com' } })).rejects.toMatchObject({ code: 'demo_unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
    const saved = JSON.parse(persistentStorage.getItem('lifehub.demo.v1')!);
    expect(saved.tokens).toBeUndefined();
    client.clearSession();
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [] })));
    expect(await client.api('/planning/tasks')).toEqual({ items: [] });
  });

  it('returns useful Russian errors without exposing raw server text', () => {
    expect(client.errorMessage(new client.ApiError(409, 'version_conflict', 'Resource changed'))).toContain('Запись уже изменилась');
    expect(client.errorMessage(new client.ApiError(500, 'unknown', 'Sensitive server exception'))).not.toContain('Sensitive');
    expect(client.errorMessage(new Error('Добавьте от 1 до 100 строк.'))).toBe('Добавьте от 1 до 100 строк.');
    expect(client.errorMessage({ message: 'Untrusted arbitrary object' })).not.toContain('Untrusted');
  });
});


describe('calendar authorization failures', () => {
  it.each(['calendar_reauth_required', 'calendar_permissions_required'])('does not replay a consumed callback for %s or log out the user', async (code) => {
    client.setSession(auth());
    const fetcher = vi.fn().mockResolvedValue(response({ error: { code, message: 'Provider rejected access', details: [] } }, 401));
    vi.stubGlobal('fetch', fetcher);
    await expect(client.api('/planning/calendar-connections/google/callback', { method: 'POST', body: { code: 'one-use-code', state: 'state' } })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getSession()?.tokens.access_token).toBe('access-old');
    expect(client.errorMessage(new client.ApiError(401, code, 'Provider rejected access'))).not.toContain('Не удалось выполнить действие');
  });
});
