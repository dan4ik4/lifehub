import { describe, expect, it } from 'vitest';
import { calendarDayBlocks, calendarOffsetLabel, eventOccupiesDay, intervalOccupiesDay, layoutBlocks, taskOccupiesDay } from './CalendarView';
import type { CalendarEvent, CalendarRange, Task, TaskOccurrence } from '../lib/types';

function task(values: Partial<Task> = {}): Task {
  return { id: 'task-1', title: 'Task', notes: null, start_at: null, due_at: null, timezone: 'UTC', all_day: false,
    priority: 'none', recurrence: null, completed: false, next_occurrence_at: null, reminders: [], version: 1,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...values };
}

function event(values: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'event-1', title: 'Event', notes: null, start_at: '2026-09-05T09:00:00Z', end_at: '2026-09-05T10:00:00Z', timezone: 'UTC',
    all_day: false, recurrence: null, source: 'local', connection_id: null, external_read_only: false, version: 1,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', occurrence_at: null, ...values };
}

function occurrence(start: string | null, due: string | null): TaskOccurrence {
  return { task_id: 'task-1', occurrence_at: null, status: 'pending', completed_at: null, effective_start_at: start, effective_due_at: due };
}

function calendar(tasks: TaskOccurrence[] = [], events: CalendarEvent[] = []): CalendarRange {
  return { from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z', timezone: 'UTC', tasks, events };
}

describe('calendar intervals and all-day dates', () => {
  it('shows an interval task on its start, intermediate and final occupied days', () => {
    const item = task(), span = occurrence('2026-09-05T09:00:00Z', '2026-09-07T13:00:00Z');
    expect(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'].map(day => taskOccupiesDay(item, span, day, 'UTC')))
      .toEqual([false, true, true, true, false]);
    expect(calendarDayBlocks('2026-09-05', 'UTC', calendar([span]), [item]).map(({ start, end }) => [start, end])).toEqual([[540, 1440]]);
    expect(calendarDayBlocks('2026-09-06', 'UTC', calendar([span]), [item]).map(({ start, end }) => [start, end])).toEqual([[0, 1440]]);
    expect(calendarDayBlocks('2026-09-07', 'UTC', calendar([span]), [item]).map(({ start, end }) => [start, end])).toEqual([[0, 780]]);
  });

  it('uses half-open interval ends and keeps single-time task markers', () => {
    expect(intervalOccupiesDay('2026-09-05T23:00:00Z', '2026-09-06T00:00:00Z', '2026-09-06', 'UTC')).toBe(false);
    expect(intervalOccupiesDay('2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z', '2026-09-06', 'UTC')).toBe(true);
    const point = occurrence(null, '2026-09-05T23:55:00Z');
    expect(calendarDayBlocks('2026-09-05', 'UTC', calendar([point]), [task()])).toMatchObject([{ start: 1435, end: 1440, point: true }]);
    expect(calendarDayBlocks('2026-09-06', 'UTC', calendar([point]), [task()])).toEqual([]);
  });

  it('keeps all-day multi-day events on their own calendar dates in another viewing timezone', () => {
    const allDay = event({ all_day: true, timezone: 'Asia/Tokyo', start_at: '2026-09-04T15:00:00Z', end_at: '2026-09-07T15:00:00Z' });
    expect(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'].map(day => eventOccupiesDay(allDay, day, 'America/Los_Angeles')))
      .toEqual([false, true, true, true, false]);
    expect(calendarDayBlocks('2026-09-05', 'America/Los_Angeles', calendar([], [allDay]), [])).toEqual([]);
    const allDayTask = task({ all_day: true, timezone: 'Asia/Tokyo' });
    expect(taskOccupiesDay(allDayTask, occurrence('2026-09-04T15:00:00Z', '2026-09-07T15:00:00Z'), '2026-09-07', 'America/Los_Angeles')).toBe(true);
    expect(taskOccupiesDay(allDayTask, occurrence(null, '2026-09-04T15:00:00Z'), '2026-09-05', 'America/Los_Angeles')).toBe(true);
  });

  it('clips multi-day events and preserves occurrence objects for editing/completion', () => {
    const recurringEvent = event({ start_at: '2026-09-04T23:00:00Z', end_at: '2026-09-06T01:00:00Z',
      occurrence_at: '2026-09-04T23:00:00Z', recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'UTC', human_text: 'Weekly', next_occurrence_at: null } });
    const recurringTask = task({ recurrence: { rrule: 'FREQ=DAILY', timezone: 'UTC', human_text: 'Daily', next_occurrence_at: null } });
    const item = { ...occurrence('2026-09-05T09:00:00Z', '2026-09-05T09:10:00Z'), occurrence_at: '2026-09-05T09:00:00Z' };
    const blocks = calendarDayBlocks('2026-09-05', 'UTC', calendar([item], [recurringEvent]), [recurringTask]);
    expect(blocks[0]).toMatchObject({ start: 0, end: 1440 });
    expect(blocks[0].event).toBe(recurringEvent);
    expect(blocks[1]).toMatchObject({ start: 540, end: 550 });
    expect(blocks[1].task).toBe(recurringTask);
    expect(blocks[1].occurrence).toBe(item);
  });

  it('uses the selected date offset rather than the current date offset', () => {
    expect(calendarOffsetLabel('2026-01-15', 'Europe/Warsaw')).toBe('GMT+1');
    expect(calendarOffsetLabel('2026-07-15', 'Europe/Warsaw')).toBe('GMT+2');
    expect(calendarOffsetLabel('2026-07-15', 'Asia/Kathmandu')).toBe('GMT+5:45');
  });

  it('splits a DST fall-back interval into its actual clock segments without negative heights', () => {
    const change = event({ start_at: '2026-10-25T00:45:00Z', end_at: '2026-10-25T01:15:00Z', timezone: 'Europe/Warsaw' });
    const blocks = calendarDayBlocks('2026-10-25', 'Europe/Warsaw', calendar([], [change]), []);
    expect(blocks.map(({ start, end, offset }) => [start, end, offset])).toEqual([[165, 180, 'GMT+2'], [120, 135, 'GMT+1']]);
    expect(new Set(blocks.map(block => block.id)).size).toBe(2);
    expect(blocks.every(block => block.event === change)).toBe(true);
  });

  it('does not occupy the nonexistent clock hour on a DST spring-forward day', () => {
    const change = event({ start_at: '2026-03-29T00:30:00Z', end_at: '2026-03-29T01:30:00Z', timezone: 'Europe/Warsaw' });
    const blocks = calendarDayBlocks('2026-03-29', 'Europe/Warsaw', calendar([], [change]), []);
    expect(blocks.map(({ start, end }) => [start, end])).toEqual([[90, 120], [180, 210]]);
  });
});

describe('overlap layout', () => {
  it('allocates lanes for connected overlap groups and reuses the full width afterward', () => {
    const result = layoutBlocks([{ start: 540, end: 600 }, { start: 570, end: 630 }, { start: 630, end: 640 }, { start: 640, end: 650 }]);
    expect(result.map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 2], [1, 2], [0, 1], [0, 1]]);
  });
});
