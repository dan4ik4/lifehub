import english from './english.json';
import polish from './polish.json';

const locales = { ru: 'ru-RU', en: 'en-GB', pl: 'pl-PL' } as const;
export type Language = keyof typeof locales;

const storageKey = 'lifehub.language';
const dictionaries: Record<Exclude<Language, 'ru'>, Readonly<Record<string, string>>> = {
  en: english,
  pl: polish,
};

function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === 'en' || saved === 'pl' ? saved : 'ru';
  } catch {
    return 'ru';
  }
}

export const language = readLanguage();
export const locale = locales[language];
export const decimalSeparator = new Intl.NumberFormat(locale)
  .formatToParts(1.1).find(part => part.type === 'decimal')!.value;

export function saveLanguage(next: Language): void {
  localStorage.setItem(storageKey, next);
}

export function translate(target: Language, message: string, ...values: unknown[]): string {
  const dictionary = target === 'ru' ? undefined : dictionaries[target];
  const translated = dictionary && Object.hasOwn(dictionary, message) ? dictionary[message] : message;
  if (!values.length) return translated;
  return translated.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

export function t(message: string, ...values: unknown[]): string {
  return translate(language, message, ...values);
}
