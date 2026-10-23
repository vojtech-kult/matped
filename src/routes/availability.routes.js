import { Router } from 'express';
import { Availability } from '../models/Availability.js';
import { requireRole } from '../middleware/auth.js';
import { LECTURERS, FIRST_HOUR, LAST_HOUR, WEEK_MIN, isoWeeksInYear } from '../config/schedule.js';
import { Lesson } from '../models/Lesson.js';
import '../models/Student.js'; // model musí být registrovaný kvůli populate
import { weekDates, todayInPrague, hourInPrague } from '../utils/calendar.js';
import { LessonRecord } from '../models/LessonRecord.js';
import { CAPACITY } from '../config/schedule.js';

const router = Router();
router.use(requireRole('admin'));

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Ověří, které políčko se mění. Vrací { slot, maxWeek } nebo { error }.
function parseSlot(body) {
  const { lecturer, year, day, hour } = body ?? {};
  const week = body?.week ?? null;

  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer)) return { error: 'Neznámý lektor' };
  if (!isInt(year, 2000, 2100)) return { error: 'Neplatný rok' };
  if (!isInt(day, 1, 7)) return { error: 'Neplatný den' };
  if (!isInt(hour, FIRST_HOUR, LAST_HOUR)) return { error: 'Neplatná hodina' };

  const maxWeek = isoWeeksInYear(year);
  if (week !== null && !isInt(week, WEEK_MIN, maxWeek)) {
    return { error: `Číslo týdne musí být ${WEEK_MIN} až ${maxWeek}` };
  }
  return { slot: { lecturer, year, day, hour, week }, maxWeek };
}

router.get('/config', (req, res) => {
  res.json({ lecturers: LECTURERS, firstHour: FIRST_HOUR, lastHour: LAST_HOUR });
});

// Všechna políčka lektora v daném roce
router.get('/', async (req, res) => {
  const { lecturer } = req.query;
  const year = Number(req.query.year);
  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer) || !isInt(year, 2000, 2100)) {
    return res.status(400).json({ error: 'Neplatný lektor nebo rok' });
  }

  const slots = await Availability.find({ lecturer, year })
    .select('-_id day hour week excludedWeeks')
    .lean();
  res.json(slots);
});

// Rezervace lektora v jednom týdnu (pro obarvení kalendáře)
router.get('/lessons', async (req, res) => {
  const { lecturer } = req.query;
  const year = Number(req.query.year);
  const week = Number(req.query.week);
  if (
    typeof lecturer !== 'string' || !LECTURERS.includes(lecturer) ||
    !isInt(year, 2000, 2100) || !isInt(week, WEEK_MIN, isoWeeksInYear(year))
  ) {
    return res.status(400).json({ error: 'Neplatný lektor, rok nebo týden' });
  }

  const dates = weekDates(year, week);
  const lessons = await Lesson.find({ lecturer, date: { $in: dates }, count: { $gt: 0 } })
    .select('date hour students')
    .populate('students', 'studentNumber')
    .lean();

  res.json(
    lessons.map((l) => ({
      day: dates.indexOf(l.date) + 1,
      hour: l.hour,
      students: l.students.filter(Boolean).map((s) => s.studentNumber).sort(),
    }))
  );
});


const UPCOMING_LIMIT = 15;

// Nejbližší lekce lektora, na které jsou přihlášení studenti
router.get('/upcoming', async (req, res) => {
  const { lecturer } = req.query;
  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer)) {
    return res.status(400).json({ error: 'Neznámý lektor' });
  }

  const today = todayInPrague();
  const hour = hourInPrague();

  const lessons = await Lesson.find({
    lecturer,
    count: { $gt: 0 },
    $or: [{ date: { $gt: today } }, { date: today, hour: { $gte: hour } }],
  })
    .select('date hour students')
    .sort({ date: 1, hour: 1 })
    .limit(UPCOMING_LIMIT)
    .populate('students', 'studentNumber name')
    .lean();

  const records = await LessonRecord.find({ lecturer, date: { $gte: today } })
    .select('student date hour paid')
    .lean();
  const paidMap = new Map(records.map((r) => [`${r.student}|${r.date}|${r.hour}`, r.paid]));

  res.json({
    today,
    capacity: CAPACITY,
    lessons: lessons.map((l) => ({
      date: l.date,
      hour: l.hour,
      students: l.students
        .filter(Boolean)
        .map((s) => ({
          studentNumber: s.studentNumber,
          name: s.name,
          paid: paidMap.get(`${s._id}|${l.date}|${l.hour}`) ?? false,
        }))
        .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber)),
    })),
  });
});



const PAST_LIMIT = 30;

// Odučené lekce lektora (už skončily), nejnovější první
router.get('/past', async (req, res) => {
  const { lecturer } = req.query;
  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer)) {
    return res.status(400).json({ error: 'Neznámý lektor' });
  }

  const today = todayInPrague();
  const hour = hourInPrague();

  const lessons = await Lesson.find({
    lecturer,
    count: { $gt: 0 },
    $or: [{ date: { $lt: today } }, { date: today, hour: { $lt: hour } }],
  })
    .select('date hour students')
    .sort({ date: -1, hour: -1 })
    .limit(PAST_LIMIT)
    .populate('students', 'studentNumber name')
    .lean();

  const dates = [...new Set(lessons.map((l) => l.date))];
  const records = dates.length
    ? await LessonRecord.find({ lecturer, date: { $in: dates } })
        .select('student date hour attended paid')
        .lean()
    : [];
  const recordMap = new Map(records.map((r) => [`${r.student}|${r.date}|${r.hour}`, r]));

  res.json({
    limit: PAST_LIMIT,
    lessons: lessons.map((l) => ({
      date: l.date,
      hour: l.hour,
      students: l.students
        .filter(Boolean)
        .map((s) => {
          const rec = recordMap.get(`${s._id}|${l.date}|${l.hour}`);
          return {
            studentNumber: s.studentNumber,
            name: s.name,
            attended: rec?.attended ?? null,
            paid: rec?.paid ?? false,
          };
        })
        .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber)),
    })),
  });
});




const MAX_BATCH = 500;

// Uložení všech změn rozvrhu jedním požadavkem (vše se zvaliduje dřív, než se cokoli zapíše)
router.put('/batch', async (req, res) => {
  const { lecturer, year } = req.body ?? {};
  const put = req.body?.put ?? [];
  const del = req.body?.delete ?? [];
  if (!Array.isArray(put) || !Array.isArray(del) || put.length + del.length > MAX_BATCH) {
    return res.status(400).json({ error: 'Neplatný seznam změn' });
  }

  const ops = [];
  for (const item of put) {
    const { slot, maxWeek, error } = parseSlot({ lecturer, year, day: item?.day, hour: item?.hour, week: item?.week });
    if (error) return res.status(400).json({ error });

    let excludedWeeks = [];
    if (slot.week === null) {
      const raw = item.excludedWeeks ?? [];
      if (!Array.isArray(raw) || raw.length > 60 || !raw.every((w) => isInt(w, WEEK_MIN, maxWeek))) {
        return res.status(400).json({ error: `Výjimky: čísla týdnů ${WEEK_MIN} až ${maxWeek}` });
      }
      excludedWeeks = [...new Set(raw)].sort((a, b) => a - b);
    }
    ops.push({ updateOne: { filter: slot, update: { $set: { excludedWeeks } }, upsert: true } });
  }
  for (const item of del) {
    const { slot, error } = parseSlot({ lecturer, year, day: item?.day, hour: item?.hour, week: item?.week });
    if (error) return res.status(400).json({ error });
    ops.push({ deleteOne: { filter: slot } });
  }

  if (ops.length) await Availability.bulkWrite(ops);
  res.json({ ok: true });
});

export default router;