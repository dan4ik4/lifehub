import { describe, expect, it } from 'vitest';
import { dateKey, monthDays, shiftDay, startOfDay, weekDays, zonedISO } from './dates';

describe('calendar timezone conversion', () => {
  it('uses the selected timezone and the date-specific UTC offset', () => {
    expect(zonedISO('2026-01-15', '10:00', 'Europe/Warsaw')).toBe('2026-01-15T09:00:00.000Z');
    expect(zonedISO('2026-07-15', '10:00', 'Europe/Warsaw')).toBe('2026-07-15T08:00:00.000Z');
    expect(zonedISO('2026-07-15', '10:00', 'Asia/Kathmandu')).toBe('2026-07-15T04:15:00.000Z');
    expect(zonedISO('2026-07-15', '00:00', 'America/New_York')).toBe('2026-07-15T04:00:00.000Z');
  });

  it('rejects a nonexistent local time instead of silently moving the appointment', () => {
    expect(() => zonedISO('2026-03-29', '02:30', 'Europe/Warsaw')).toThrow('переводе часов');
    expect(() => zonedISO('2026-03-08', '02:30', 'America/New_York')).toThrow('переводе часов');
  });

  it('keeps all-day boundaries at local midnight across 23-hour and 25-hour days', () => {
    const duration = (day: string) => (Date.parse(startOfDay(shiftDay(day, 1), 'Europe/Warsaw')) - Date.parse(startOfDay(day, 'Europe/Warsaw'))) / 3600000;
    expect(duration('2026-03-29')).toBe(23);
    expect(duration('2026-10-25')).toBe(25);
    expect(duration('2026-09-05')).toBe(24);
  });

  it('assigns a date using the viewing timezone rather than the machine timezone', () => {
    expect(dateKey('2026-09-05T00:30:00Z', 'America/New_York')).toBe('2026-09-04');
    expect(dateKey('2026-09-05T23:30:00Z', 'Europe/Warsaw')).toBe('2026-09-06');
  });

  it('navigates across leap days and year boundaries without local-time arithmetic', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2028-02-29', 1)).toBe('2028-03-01');
    expect(weekDays('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    const days = monthDays('2026-09-05');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-08-31');
    expect(days[41]).toBe('2026-10-11');
  });
});
