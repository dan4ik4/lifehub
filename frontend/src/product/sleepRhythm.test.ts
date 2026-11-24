import { describe, expect, it } from 'vitest';
import { sleepRhythm } from './sleepRhythm';

describe('sleep rhythm', () => {
  it('retains every wake date in a 90-day period', () => {
    const records = Array.from({length: 90}, (_, index) => ({
      start_at: new Date(Date.UTC(2026, 0, index + 1, 22)).toISOString(),
      end_at: new Date(Date.UTC(2026, 0, index + 2, 6)).toISOString(),
      hours: 8,
    }));
    const {byDay} = sleepRhythm(records, 'UTC');
    expect(byDay.size).toBe(90);
    expect(byDay.get('2026-01-02')?.total).toBe(8);
    expect(byDay.get('2026-04-01')?.slots[0]).toMatchObject({start: -120, end: 360});
  });

  it('extends the axis for a daytime nap and groups it with the night sleep', () => {
    const records = [
      {start_at: '2026-11-01T22:00:00Z', end_at: '2026-11-02T06:00:00Z', hours: 8},
      {start_at: '2026-11-02T14:00:00Z', end_at: '2026-11-02T15:00:00Z', hours: 1},
    ];
    const {byDay, end} = sleepRhythm(records, 'Europe/Warsaw');
    const day = byDay.get('2026-11-02')!;
    expect(day.total).toBe(9);
    expect(day.slots.map(slot=>slot.label)).toEqual(['23:00–07:00','15:00–16:00']);
    expect(end).toBeGreaterThanOrEqual(day.slots[1].end);
  });

  it('preserves a positive interval when the clock repeats', () => {
    const {byDay} = sleepRhythm([
      {start_at: '2026-10-25T00:50:00Z', end_at: '2026-10-25T01:10:00Z', hours: 1/3},
    ], 'Europe/Warsaw');
    const slot = byDay.get('2026-10-25')!.slots[0];
    expect(slot.label).toBe('02:50–02:10');
    expect(slot.end-slot.start).toBe(20);
  });
});
