import { describe, expect, it } from 'vitest';
import { entityPayload, initialEntityFields } from './EntityEditor';
import type { CalendarEvent, Task } from '../lib/types';

const task: Task = {
  id: 'task-id', title: 'Original', notes: null, start_at: '2026-09-05T09:15:37.123Z', due_at: null,
  timezone: 'Europe/Warsaw', all_day: false, priority: 'none', recurrence: null, completed: false,
  next_occurrence_at: null, reminders: [], version: 4, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
};
const event: CalendarEvent = {
  id: 'event-id', title: 'DST meeting', notes: null, start_at: '2026-10-25T02:30:17+02:00', end_at: '2026-10-25T02:15:38+01:00',
  timezone: 'Europe/Warsaw', all_day: false, recurrence: null, source: 'local', connection_id: null,
  external_read_only: false, version: 3, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', occurrence_at: null,
};

describe('editor request semantics', () => {
  it('keeps a start-only task without a deadline when changing its title', () => {
    const fields = initialEntityFields('task', task, '2026-09-05', 'UTC');
    expect(fields.hasDate).toBe(false);
    expect(fields.hasStart).toBe(true);
    const payload = entityPayload('task', task, { ...fields, title: 'Renamed' }, 'UTC', false);
    expect(payload).toMatchObject({ title: 'Renamed', start_at: task.start_at, due_at: null, all_day: false, version: 4 });
  });

  it('preserves all-day start-only tasks in the object timezone', () => {
    const original = { ...task, start_at: '2026-09-04T22:00:00Z', all_day: true };
    const fields = initialEntityFields('task', original, '2026-09-05', 'America/New_York');
    const payload = entityPayload('task', original, { ...fields, notes: 'A note' }, 'America/New_York', false);
    expect(payload).toMatchObject({ due_at: null, start_at: original.start_at, all_day: true, timezone: 'Europe/Warsaw' });
  });

  it('preserves both explicit DST folds and seconds during a title-only edit', () => {
    const fields = initialEntityFields('event', event, '2026-10-25', 'Europe/Warsaw');
    const payload = entityPayload('event', event, { ...fields, title: 'Changed title' }, 'Europe/Warsaw', false);
    expect(payload.start_at).toBe(event.start_at);
    expect(payload.end_at).toBe(event.end_at);
    expect(payload.title).toBe('Changed title');
  });

  it('recalculates only an explicitly changed time', () => {
    const original = { ...task, due_at: '2026-09-05T12:00:43.456Z' };
    const fields = initialEntityFields('task', original, '2026-09-05', 'Europe/Warsaw');
    const payload = entityPayload('task', original, { ...fields, time: '15:30' }, 'Europe/Warsaw', false);
    expect(payload.start_at).toBe(original.start_at);
    expect(payload.due_at).toBe('2026-09-05T13:30:00.000Z');
  });

  it('retains the clicked hour and rolls a 23:00 event end into the next day', () => {
    const fields = initialEntityFields('event', undefined, '2026-09-05', 'Europe/Warsaw', '23:00');
    const payload = entityPayload('event', undefined, { ...fields, title: 'Late meeting' }, 'Europe/Warsaw', false);
    expect(payload.start_at).toBe('2026-09-05T21:00:00.000Z');
    expect(payload.end_at).toBe('2026-09-05T22:00:00.000Z');
  });

  it('uses an exclusive next-midnight end for an all-day event across DST', () => {
    const fields = initialEntityFields('event', undefined, '2026-03-29', 'Europe/Warsaw');
    const payload = entityPayload('event', undefined, { ...fields, title: 'Day off', allDay: true }, 'Europe/Warsaw', false);
    expect(payload.start_at).toBe('2026-03-28T23:00:00.000Z');
    expect(payload.end_at).toBe('2026-03-29T22:00:00.000Z');
  });

  it('lets a Free user explicitly remove premium settings without changing the schedule', () => {
    const original: Task = { ...task, priority: 'high', recurrence: { rrule: 'FREQ=DAILY', human_text: 'Daily', timezone: 'Europe/Warsaw', next_occurrence_at: null } };
    const fields = initialEntityFields('task', original, '2026-09-05', 'Europe/Warsaw');
    expect(() => entityPayload('task', original, fields, 'Europe/Warsaw', false)).toThrow('отключите повторение и приоритет');
    const payload = entityPayload('task', original, { ...fields, rrule: '', priority: 'none' }, 'Europe/Warsaw', false);
    expect(payload).toMatchObject({ rrule: null, priority: 'none', start_at: original.start_at, due_at: null });
  });

  it('returns a specific local validation error for a DST gap and missing reminder date', () => {
    const fields = initialEntityFields('event', undefined, '2026-03-29', 'Europe/Warsaw', '02:30');
    expect(() => entityPayload('event', undefined, { ...fields, title: 'Meeting' }, 'Europe/Warsaw', false)).toThrow('переводе часов');
    const unscheduled = initialEntityFields('task', undefined, '2026-09-05', 'UTC');
    expect(() => entityPayload('task', undefined, { ...unscheduled, title: 'Task', hasDate: false, reminder: '15' }, 'UTC', false)).toThrow('Добавьте дату');
  });
});
