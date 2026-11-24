import english from './english.json';

export type Language = 'ru' | 'en';

const storageKey = 'lifehub.language';
const englishMessages: Readonly<Record<string, string>> = english;

function readLanguage(): Language {
  try {
    return localStorage.getItem(storageKey) === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

export const language = readLanguage();
export const locale = language === 'en' ? 'en-GB' : 'ru-RU';
export const decimalSeparator = new Intl.NumberFormat(locale)
  .formatToParts(1.1).find(part => part.type === 'decimal')!.value;

export function saveLanguage(next: Language): void {
  localStorage.setItem(storageKey, next);
}

export function translate(target: Language, message: string, ...values: unknown[]): string {
  const translated = target === 'en' && Object.hasOwn(englishMessages, message)
    ? englishMessages[message] : message;
  if (!values.length) return translated;
  return translated.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

export function t(message: string, ...values: unknown[]): string {
  return translate(language, message, ...values);
}
