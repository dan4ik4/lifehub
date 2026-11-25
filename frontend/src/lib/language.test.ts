import { describe, expect, it, vi } from 'vitest';
import { translate } from './language';
import english from './english.json';
import polish from './polish.json';

describe('interface language', () => {
  it('translates UI messages and interpolates user text without translating it', () => {
    expect(translate('en', 'Изменить {0}', 'Моя заметка')).toBe('Edit Моя заметка');
    expect(translate('ru', 'Изменить {0}', 'Моя заметка')).toBe('Изменить Моя заметка');
    expect(translate('pl', 'Изменить {0}', 'Моя заметка')).toBe('Edytuj Моя заметка');
  });

  it.each([
    ['en', '24 November', '1,234.56', ['21 tasks', '22 tasks']],
    ['pl', '24 listopada', '1234,56', ['21 zadań', '22 zadania']],
  ] as const)('persists %s and uses its formatting on the next load', async (selected, date, amount, counts) => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    try {
      vi.resetModules();
      const firstLoad = await import('./language');
      expect(firstLoad.language).toBe('ru');
      firstLoad.saveLanguage(selected);
      vi.resetModules();

      const secondLoad = await import('./language');
      const { dayLabel, plural } = await import('./dates');
      const { formatAmount } = await import('../product/format');
      expect(secondLoad.language).toBe(selected);
      expect(dayLabel('2026-11-24')).toBe(date);
      expect(formatAmount('1234.56')).toBe(amount);
      const forms: [string, string, string] = selected === 'pl' ? ['zadanie', 'zadania', 'zadań'] : ['task', 'tasks', 'tasks'];
      expect([plural(21, forms), plural(22, forms)]).toEqual(counts);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('covers the shared interface messages and preserves every placeholder in Polish', () => {
    const dictionary: Record<string, string> = polish;
    expect(Object.keys(english).filter(key => !dictionary[key]?.trim())).toEqual([]);
    const placeholders = (message: string) => message.match(/\{\d+\}/g)?.sort() ?? [];
    expect(Object.entries(polish).filter(([key, value]) =>
      JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value)),
    ).map(([key]) => key)).toEqual([]);
  });
});
