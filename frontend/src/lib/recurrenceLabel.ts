const CUSTOM_LABEL = 'По своему расписанию';
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function quantity(value: number, words: [string, string, string]) {
  const last = value % 10, lastTwo = value % 100;
  return `${value} ${words[lastTwo >= 11 && lastTwo <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}

/** Translate understood rule shapes only; never guess the meaning of custom BY* rules. */
export function recurrenceLabel(rule: string, timezone = 'UTC'): string {
  const source = rule.trim().replace(/^RRULE:/i, '').toUpperCase();
  if (!source || source.length > 2048 || /\s/.test(source)) return CUSTOM_LABEL;
  const values = new Map<string, string>();
  for (const part of source.split(';')) {
    const match = /^([A-Z]+)=([^=]+)$/.exec(part);
    if (!match || values.has(match[1])) return CUSTOM_LABEL;
    values.set(match[1], match[2]);
  }
  const frequency = values.get('FREQ');
  const allowed = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY', 'BYMONTHDAY', 'BYMONTH']);
  if ([...values.keys()].some(key => !allowed.has(key))) return CUSTOM_LABEL;
  if (values.has('WKST') && !WEEKDAYS.includes(values.get('WKST')!)) return CUSTOM_LABEL;
  const intervalRaw = values.get('INTERVAL') || '1';
  const interval = Number(intervalRaw);
  if (!/^\d+$/.test(intervalRaw) || !Number.isSafeInteger(interval) || interval < 1 || interval > 2_147_483_647) return CUSTOM_LABEL;
  const countRaw = values.get('COUNT');
  const count = countRaw ? Number(countRaw) : undefined;
  if (countRaw && (!/^\d+$/.test(countRaw) || !Number.isSafeInteger(count) || count! < 1 || count! > 2_147_483_647 || values.has('UNTIL'))) return CUSTOM_LABEL;

  let label: string;
  if (frequency === 'DAILY') label = interval === 1 ? 'Каждый день' : `Раз в ${quantity(interval, ['день', 'дня', 'дней'])}`;
  else if (frequency === 'WEEKLY') label = interval === 1 ? 'Каждую неделю' : `Раз в ${quantity(interval, ['неделю', 'недели', 'недель'])}`;
  else if (frequency === 'MONTHLY') label = interval === 1 ? 'Каждый месяц' : `Раз в ${quantity(interval, ['месяц', 'месяца', 'месяцев'])}`;
  else if (frequency === 'YEARLY') label = interval === 1 ? 'Каждый год' : `Раз в ${quantity(interval, ['год', 'года', 'лет'])}`;
  else return CUSTOM_LABEL;

  const byDay = values.get('BYDAY');
  if (byDay) {
    const days = byDay.split(',');
    if (new Set(days).size !== days.length || days.some(day => !WEEKDAYS.includes(day))) return CUSTOM_LABEL;
    const weekdaysOnly = days.length === 5 && WEEKDAYS.slice(0, 5).every(day => days.includes(day));
    if (frequency === 'DAILY' && interval === 1 && weekdaysOnly) label = 'По будням';
    else if (frequency === 'WEEKLY') {
      if (weekdaysOnly) label = interval === 1 ? 'По будням' : `По будням, раз в ${quantity(interval, ['неделю', 'недели', 'недель'])}`;
      else label += `: ${WEEKDAYS.filter(day => days.includes(day)).map(day => DAY_NAMES[WEEKDAYS.indexOf(day)]).join(', ')}`;
    } else return CUSTOM_LABEL;
  }

  const monthDayRaw = values.get('BYMONTHDAY'), monthRaw = values.get('BYMONTH');
  const monthDay = Number(monthDayRaw), month = Number(monthRaw);
  if (monthDayRaw) {
    if (!/^\d+$/.test(monthDayRaw) || monthDay < 1 || monthDay > 31 || byDay) return CUSTOM_LABEL;
    if (frequency === 'MONTHLY' && !monthRaw) label += `, ${monthDay}-го числа`;
    else if (frequency === 'YEARLY' && monthRaw && /^\d+$/.test(monthRaw) && month >= 1 && month <= 12) {
      const at = new Date(Date.UTC(2024, month - 1, monthDay));
      if (at.getUTCMonth() !== month - 1) return CUSTOM_LABEL;
      label += `, ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(at)}`;
    } else return CUSTOM_LABEL;
  } else if (monthRaw) return CUSTOM_LABEL;

  if (count !== undefined) label += ` · ${quantity(count, ['повторение', 'повторения', 'повторений'])}`;
  const until = values.get('UNTIL');
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(until);
    if (!match) return CUSTOM_LABEL;
    const at = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}Z`);
    if (!Number.isFinite(at.getTime()) || at.getUTCFullYear() !== +match[1] || at.getUTCMonth() + 1 !== +match[2] || at.getUTCDate() !== +match[3]) return CUSTOM_LABEL;
    try {
      label += ` · до ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: match[4] ? timezone : 'UTC' }).format(at)}`;
    } catch { return CUSTOM_LABEL; }
  }
  return label;
}
