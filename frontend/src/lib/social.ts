// Provider APIs: developers.google.com/identity/gsi/web/reference/js-reference
// developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple
export interface SocialCredential { provider: 'google' | 'apple'; token: string; nonce: string }

interface GoogleIdentity {
  initialize(config: { client_id: string; callback: (result: { credential: string }) => void; nonce: string; ux_mode: 'popup'; auto_select: boolean }): void;
  renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; width: number; locale: string }): void;
}
interface AppleConfig { clientId: string; scope: string; redirectURI: string; state: string; nonce: string; usePopup: boolean }
interface AppleIdentity {
  init(config: AppleConfig): void;
  signIn(): Promise<{ authorization: { id_token: string; state: string } }>;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
    AppleID?: { auth: AppleIdentity };
  }
}

export const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim());
export const appleConfigured = Boolean(import.meta.env.VITE_APPLE_CLIENT_ID?.trim() && import.meta.env.VITE_APPLE_REDIRECT_URI?.trim());
const scripts = new Map<string, Promise<void>>();

function loadScript(source: string): Promise<void> {
  const existing = scripts.get(source);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove(); scripts.delete(source);
      reject(new Error('Сервис входа не загрузился. Проверьте подключение и обновите страницу.'));
    };
    script.src = source; script.async = true;
    script.onload = () => { window.clearTimeout(timeout); resolve(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  scripts.set(source, promise);
  return promise;
}

function randomValue(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

let googleReady = false;
let googleNonce = '';
let googleListener: ((credential: SocialCredential) => void) | null = null;

export function mountGoogleButton(element: HTMLElement, onCredential: (credential: SocialCredential) => void, onError: (error: unknown) => void): () => void {
  let active = true;
  void loadScript('https://accounts.google.com/gsi/client?hl=ru').then(() => {
    if (!active) return;
    const identity = window.google?.accounts.id;
    if (!identity) throw new Error('Вход через Google сейчас недоступен.');
    if (!googleReady) {
      googleNonce = randomValue();
      identity.initialize({ client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID, nonce: googleNonce,
        ux_mode: 'popup', auto_select: false,
        callback: result => {
          if (result.credential) googleListener?.({ provider: 'google', token: result.credential, nonce: googleNonce });
        },
      });
      googleReady = true;
    }
    googleListener = onCredential;
    identity.renderButton(element, { type: 'standard', theme: 'outline', size: 'large',
      text: 'continue_with', shape: 'rectangular', width: Math.min(400, Math.max(220, element.clientWidth)), locale: 'ru' });
  }).catch(error => { if (active) onError(error); });
  return () => {
    active = false;
    if (googleListener === onCredential) googleListener = null;
    element.replaceChildren();
  };
}

export async function prepareAppleSignIn(): Promise<() => Promise<SocialCredential>> {
  await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ru_RU/appleid.auth.js');
  const identity = window.AppleID?.auth;
  if (!identity) throw new Error('Вход через Apple сейчас недоступен.');
  const nonce = randomValue();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const state = randomValue();
  return async () => {
    identity.init({ clientId: import.meta.env.VITE_APPLE_CLIENT_ID, redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
      scope: 'name email', nonce: hashedNonce, state, usePopup: true });
    try {
      const result = await identity.signIn();
      if (!result.authorization?.id_token || result.authorization.state !== state) {
        throw new Error('Не удалось проверить ответ Apple. Повторите вход.');
      }
      return { provider: 'apple', token: result.authorization.id_token, nonce };
    } catch (error) {
      const reason = (error as { error?: string })?.error;
      if (reason === 'popup_closed_by_user' || reason === 'user_cancelled_authorize') {
        throw new Error('Вход через Apple отменён. Можно попробовать снова.');
      }
      if (error instanceof Error) throw error;
      throw new Error('Не удалось войти через Apple. Проверьте разрешение всплывающих окон.');
    }
  };
}
