import { Router } from 'express';
import mongoose from 'mongoose';
import { Lesson } from '../models/Lesson.js';
import { requireRole } from '../middleware/auth.js';
import { openSlots } from '../utils/openSlots.js';
import { bookableRange, isValidDate } from '../utils/calendar.js';
import { LECTURERS, LECTURER_COLORS, CAPACITY, FIRST_HOUR, LAST_HOUR } from '../config/schedule.js';
import { LessonRecord } from '../models/LessonRecord.js';
import { Progress } from '../models/Progress.js';
import { buildProgress } from '../utils/progress.js';
import { Student } from '../models/Student.js';
import { todayInPrague, hourInPrague } from '../utils/calendar.js';
import { curriculumOf } from '../utils/progress.js';

const router = Router();
router.use(requireRole('student'));

function parseBooking(body) {
  const { lecturer, date, hour } = body ?? {};
  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer)) return { error: 'Neznámý lektor' };

  const { from, to } = bookableRange();
  if (!isValidDate(date) || date < from || date > to) return { error: 'Neplatné datum' };
  if (!Number.isInteger(hour) || hour < FIRST_HOUR || hour > LAST_HOUR) return { error: 'Neplatná hodina' };
  return { lecturer, date, hour };
}

// Základní údaje přihlášeného studenta
router.get('/me', async (req, res) => {
  const s = await Student.findById(req.session.userId).select('studentNumber name credits').lean();
  if (!s) return res.status(404).json({ error: 'Student nenalezen' });
  res.json({ studentNumber: s.studentNumber, name: s.name ?? '', credits: s.credits ?? 0 });
});

// Nadcházející lekce studenta (nejvýše 15)
router.get('/bookings', async (req, res) => {
  const studentId = new mongoose.Types.ObjectId(req.session.userId);
  const today = todayInPrague();
  const nowHour = hourInPrague();
  const { from } = bookableRange(); // od tohoto dne lze rezervaci rušit

  const lessons = await Lesson.find({ students: studentId, date: { $gte: today } })
    .select('-_id lecturer date hour')
    .sort({ date: 1, hour: 1 })
    .limit(30)
    .lean();

  res.json({
    today,
    lessons: lessons
      .filter((l) => l.date > today || l.hour >= nowHour) // dnešní lekce, které už začaly, se nezobrazí
      .slice(0, 15)
      .map((l) => ({ ...l, cancellable: l.date >= from })),
  });
});

// Rozvrh od zítřka: jen dny, kdy někdo učí, s obsazeností
router.get('/slots', async (req, res) => {
  const { from, to } = bookableRange();
  const days = await openSlots(from, to);

  const lessons = await Lesson.find({ date: { $gte: from, $lte: to } })
    .select('-_id lecturer date hour students')
    .lean();
  const lessonMap = new Map(lessons.map((l) => [`${l.lecturer}|${l.date}|${l.hour}`, l]));
  const me = String(req.session.userId);
  const me2 = await Student.findById(req.session.userId).select('credits').lean();

  res.json({
    capacity: CAPACITY,
    colors: LECTURER_COLORS,
    firstHour: FIRST_HOUR,
    lastHour: LAST_HOUR,
    credits: me2?.credits ?? 0,
    days: days.map((d) => ({
      date: d.date,
      year: d.year,
      week: d.week,
      day: d.day,
      slots: d.slots
        .sort((a, b) => a.hour - b.hour || LECTURERS.indexOf(a.lecturer) - LECTURERS.indexOf(b.lecturer))
        .map((s) => {
          const lesson = lessonMap.get(`${s.lecturer}|${d.date}|${s.hour}`);
          return {
            lecturer: s.lecturer,
            hour: s.hour,
            booked: lesson?.students.length ?? 0,
            mine: lesson?.students.some((id) => String(id) === me) ?? false,
          };
        }),
    })),
  });
});

router.post('/bookings', async (req, res) => {
  const { lecturer, date, hour, error } = parseBooking(req.body);
  if (error) return res.status(400).json({ error });

  const studentId = new mongoose.Types.ObjectId(req.session.userId);

  // Lekce musí v rozvrhu lektora opravdu existovat
  const open = await openSlots(date, date);
  const exists = open.some((d) => d.slots.some((s) => s.lecturer === lecturer && s.hour === hour));
  if (!exists) return res.status(409).json({ error: 'Tato lekce už není k dispozici' });

  // Student nemůže být ve stejnou dobu u dvou lektorů
  if (await Lesson.exists({ date, hour, students: studentId })) {
    return res.status(409).json({ error: 'V tuto dobu už máte rezervovanou lekci' });
  }

  // 1 kredit = 1 lekce. Atomicky odečteme, jen pokud student nějaký má.
  const charged = await Student.updateOne({ _id: studentId, credits: { $gte: 1 } }, { $inc: { credits: -1 } });
  if (!charged.modifiedCount) {
    return res.status(402).json({ error: 'Nemáte dostatek kreditů pro rezervaci lekce' });
  }
  const refund = () => Student.updateOne({ _id: studentId }, { $inc: { credits: 1 } });

  try {
    const result = await Lesson.updateOne(
      { lecturer, date, hour, count: { $not: { $gte: CAPACITY } }, students: { $ne: studentId } },
      { $push: { students: studentId }, $inc: { count: 1 } },
      { upsert: true, setDefaultsOnInsert: false }
    );
    if (!result.modifiedCount && !result.upsertedCount) {
      await refund();
      return res.status(409).json({ error: 'Lekci se nepodařilo rezervovat, zkuste to znovu' });
    }
  } catch (err) {
    await refund(); // rezervace se nezapsala, kredit se vrací
    if (err.code !== 11000) throw err;

    const lesson = await Lesson.findOne({ lecturer, date, hour }).select('students').lean();
    if (lesson?.students?.some((id) => id.equals(studentId))) {
      return res.status(409).json({ error: 'Tuto lekci už máte rezervovanou' });
    }
    if (lesson && lesson.students.length >= CAPACITY) {
      return res.status(409).json({ error: 'Lekce je už obsazená' });
    }
    return res.status(409).json({ error: 'Lekci se nepodařilo rezervovat, zkuste to znovu' });
  }

  res.status(201).json({ ok: true });
});

router.delete('/bookings', async (req, res) => {
  const { lecturer, date, hour, error } = parseBooking(req.body);
  if (error) return res.status(400).json({ error });

  const studentId = new mongoose.Types.ObjectId(req.session.userId);
  const result = await Lesson.updateOne(
    { lecturer, date, hour, students: studentId },
    { $pull: { students: studentId }, $inc: { count: -1 } }
  );
  if (!result.modifiedCount) return res.status(404).json({ error: 'Rezervace nenalezena' });

  await Student.updateOne({ _id: studentId }, { $inc: { credits: 1 } });

  await LessonRecord.deleteOne({ student: studentId, lecturer, date, hour });
  res.json({ ok: true });
});

// Vlastní postup v kurzu
router.get('/progress', async (req, res) => {
  const student = await Student.findById(req.session.userId).select('curriculum').lean();
  const doc = await Progress.findOne({ student: req.session.userId }).lean();
  const progress = buildProgress(doc, curriculumOf(student));
  if (!progress.enabled) return res.json({ enabled: false, curriculum: progress.curriculum });

  res.json({
    ...progress,
    levels: progress.levels.map((l) => ({
      ...l,
      sections: l.sections.map(({ title, done }) => ({ title, done })),
    })),
  });
});

export default router;