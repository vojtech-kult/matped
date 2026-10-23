import { Availability } from '../models/Availability.js';
import { LECTURERS } from '../config/schedule.js';
import { addDays, isoParts } from './calendar.js';

// Vrátí jen dny, kde je alespoň jedna volná lekce:
// [{ date, year, week, day, slots: [{ lecturer, hour }] }]
export async function openSlots(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, ...isoParts(d) });

  const years = [...new Set(days.map((d) => d.isoYear))];
  const docs = await Availability.find({ year: { $in: years }, lecturer: { $in: LECTURERS } })
    .select('-_id lecturer year day hour week excludedWeeks')
    .lean();

  const byYearDay = new Map();
  for (const doc of docs) {
    const k = `${doc.year}-${doc.day}`;
    if (!byYearDay.has(k)) byYearDay.set(k, []);
    byYearDay.get(k).push(doc);
  }

  const result = [];
  for (const d of days) {
    const found = new Map();
    for (const doc of byYearDay.get(`${d.isoYear}-${d.isoDay}`) ?? []) {
      // pravidelný termín (mimo výjimky) nebo jednorázový termín pro tento týden
      const open = doc.week === null ? !doc.excludedWeeks.includes(d.isoWeek) : doc.week === d.isoWeek;
      if (open) found.set(`${doc.lecturer}|${doc.hour}`, { lecturer: doc.lecturer, hour: doc.hour });
    }
    if (found.size) {
      result.push({ date: d.date, year: d.isoYear, week: d.isoWeek, day: d.isoDay, slots: [...found.values()] });
    }
  }
  return result;
}