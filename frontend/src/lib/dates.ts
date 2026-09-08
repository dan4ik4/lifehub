const pad = (value: number) => String(value).padStart(2, '0');

export function parts(value: Date | string, timezone: string) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return Object.fromEntries(values.filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
}
export function dateKey(value: Date | string, timezone: string) {
  const p = parts(value, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
export const todayKey = (timezone: string) => dateKey(new Date(), timezone);
export function dayDate(key: string) { return new Date(`${key}T12:00:00Z`); }
export function shiftDay(key: string, count: number) {
  const date = dayDate(key); date.setUTCDate(date.getUTCDate() + count);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
export function weekDays(key: string) {
  const offset = (dayDate(key).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDay(key, i - offset));
}
export function monthDays(key: string) {
  const first = key.slice(0, 8) + '01';
  const start = weekDays(first)[0];
  return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}
export function shiftMonth(key: string, count: number) {
  const date = dayDate(key.slice(0, 8) + '01'); date.setUTCMonth(date.getUTCMonth() + count);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}
export function zonedISO(day: string, time: string, timezone: string) {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, date, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess), timezone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, 0);
    const difference = target - represented;
    if (!difference) return new Date(guess).toISOString();
    guess += difference;
  }
  throw new Error('Это время пропущено при переводе часов. Выберите другое время.');
}
export const startOfDay = (day: string, timezone: string) => zonedISO(day, '00:00', timezone);
export const timeText = (value: string, timezone: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
export const dayLabel = (key: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(dayDate(key));
export function shortDate(value: string, timezone: string) {
  const key = dateKey(value, timezone), today = todayKey(timezone);
  return key === today ? 'Сегодня' : key === shiftDay(today, 1) ? 'Завтра' : dayLabel(key, { day: 'numeric', month: 'short' }).replace('.', '');
}
export function minutesOfDay(value: string, timezone: string) {
  const p = parts(value, timezone); return Number(p.hour) * 60 + Number(p.minute);
}
export function plural(count: number, forms: [string, string, string]) {
  const last = count % 10, tens = count % 100;
  return `${count} ${forms[tens >= 11 && tens <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}
