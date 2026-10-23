import { BOOKING_START_OFFSET_DAYS, BOOKING_WEEKS } from '../config/schedule.js';

const TZ = 'Europe/Prague';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (date) => date.toISOString().slice(0, 10);

export function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && fmt(toUTC(s)) === s;
}

export function addDays(s, n) {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

// Dnešní datum v Česku bez ohledu na časové pásmo serveru (hosting běží v UTC)
export function todayInPrague() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ISO týden, ISO rok a den v týdnu (1 = pondělí) pro datum YYYY-MM-DD
export function isoParts(s) {
  const d = toUTC(s);
  const isoDay = d.getUTCDay() || 7;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return { isoYear, isoWeek, isoDay };
}

// Rezervovat jde od zítřka do konce třetího týdne (aktuální + 2 další)
export function bookableRange() {
  const today = todayInPrague();
  const from = addDays(today, BOOKING_START_OFFSET_DAYS);
  const { isoDay } = isoParts(from);
  const to = addDays(from, 7 - isoDay + 7 * (BOOKING_WEEKS - 1)); // neděle posledního týdne
  return { from, to };
}

// Sedm dat (pondělí až neděle) daného ISO týdne
export function weekDates(year, week) {
  const { isoDay } = isoParts(`${year}-01-04`); // 4. leden je vždy v týdnu 1
  const monday = addDays(`${year}-01-04`, -(isoDay - 1) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// Aktuální hodina (0–23) v Česku bez ohledu na časové pásmo serveru
export function hourInPrague() {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date());
  return Number(h) % 24;
}