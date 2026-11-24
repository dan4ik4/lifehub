type SleepRecord = { start_at: string; end_at: string; hours: number };
type Slot = { start: number; end: number; label: string };

const minute = 60_000;

function clock(minutes: number) {
  const withinDay = ((minutes % 1440) + 1440) % 1440;
  return [Math.floor(withinDay / 60), withinDay % 60].map(n => String(n).padStart(2, '0')).join(':');
}

export function sleepRhythm(records: SleepRecord[], zone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function wallTime(stamp: string) {
    const { year, month, day, hour, minute: minutes } = Object.fromEntries(
      formatter.formatToParts(new Date(stamp)).map(part => [part.type, part.value]),
    );
    return { day: `${year}-${month}-${day}`, midnight: Date.UTC(+year, +month - 1, +day), minutes: +hour * 60 + +minutes };
  }
  const byDay = new Map<string, { total: number; slots: Slot[] }>();
  let earliest = -4 * 60, latest = 12 * 60;
  for (const record of records) {
    const from = wallTime(record.start_at), to = wallTime(record.end_at);
    const end = to.minutes;
    let start = from.minutes + (from.midnight - to.midnight) / minute;
    // A repeated clock hour can put the end time before the start on this axis.
    if (start >= end) start = end - (Date.parse(record.end_at) - Date.parse(record.start_at)) / minute;
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
    const day = byDay.get(to.day) ?? { total: 0, slots: [] };
    day.total += record.hours;
    day.slots.push({ start, end, label: clock(from.minutes) + '–' + clock(end) });
    byDay.set(to.day, day);
  }
  const step = latest - earliest > 36 * 60 ? 12 * 60 : latest - earliest > 24 * 60 ? 6 * 60 : 4 * 60;
  const start = Math.floor(earliest / step) * step, end = Math.ceil(latest / step) * step;
  const ticks = Array.from({ length: (end - start) / step + 1 }, (_, i) => clock(start + i * step));
  return { byDay, start, end, ticks };
}
