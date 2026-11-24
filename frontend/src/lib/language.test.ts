import { describe, expect, it, vi } from 'vitest';
import { translate } from './language';

describe('interface language', () => {
  it('translates UI messages and interpolates user text without translating it', () => {
    expect(translate('en', 'Изменить {0}', 'Моя заметка')).toBe('Edit Моя заметка');
    expect(translate('ru', 'Изменить {0}', 'Моя заметка')).toBe('Изменить Моя заметка');
  });

  it('persists the selection and uses English formatting on the next load', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    try {
      vi.resetModules();
      const firstLoad = await import('./language');
      expect(firstLoad.language).toBe('ru');
      firstLoad.saveLanguage('en');
      vi.resetModules();

      const secondLoad = await import('./language');
      const { dayLabel, plural } = await import('./dates');
      const { formatAmount } = await import('../product/format');
      expect(secondLoad.language).toBe('en');
      expect(dayLabel('2026-11-24')).toBe('24 November');
      expect(formatAmount('1234.56')).toBe('1,234.56');
      expect(plural(21, ['task', 'tasks', 'tasks'])).toBe('21 tasks');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
