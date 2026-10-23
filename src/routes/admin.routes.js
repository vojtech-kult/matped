import { Router } from 'express';
import { Student } from '../models/Student.js';
import { requireRole } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { destroyStudentSessions } from '../utils/session.js';
import { isStudentNumber, isValidPassword, isName } from '../utils/validate.js';
import { Lesson } from '../models/Lesson.js';
import { LessonRecord } from '../models/LessonRecord.js';
import { LECTURERS } from '../config/schedule.js';
import { isValidDate, todayInPrague } from '../utils/calendar.js';
import { Progress } from '../models/Progress.js';
import { buildProgress, applyProgressUpdate, SECTION_LEVEL, LEVEL_DEFS } from '../utils/progress.js';

const router = Router();

// Všechny routy v tomto souboru vyžadují přihlášeného admina
router.use(requireRole('admin'));

const BAD_NUMBER = { error: 'Číslo studenta musí mít přesně 6 číslic' };
const BAD_PASSWORD = { error: 'Heslo musí mít 8 až 72 znaků' };

router.get('/students', async (req, res) => {
  const students = await Student.find()
    .sort({ studentNumber: 1 })
    .select('studentNumber name createdAt')
    .lean();

  const progressDocs = await Progress.find({ student: { $in: students.map((s) => s._id) } })
    .select('student sections tests')
    .lean();
  const byStudent = new Map(progressDocs.map((p) => [String(p.student), p]));

  res.json(
    students.map((s) => {
      const progress = buildProgress(byStudent.get(String(s._id)));
      const level = progress.levels.find((l) => l.level === progress.currentLevel);
      return {
        studentNumber: s.studentNumber,
        name: s.name,
        createdAt: s.createdAt,
        level: progress.currentLevel, // null = kurz dokončen
        levelPercent: level ? level.percent : 100,
        courseCompleted: progress.courseCompleted,
      };
    })
  );
});

router.post('/students', async (req, res) => {
  const { studentNumber, name, password } = req.body ?? {};
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);
  if (!isName(name)) return res.status(400).json({ error: 'Jméno musí mít 1 až 100 znaků' });
  if (!isValidPassword(password)) return res.status(400).json(BAD_PASSWORD);

  try {
    await Student.create({
      studentNumber,
      name: name.trim(),
      passwordHash: await hashPassword(password),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Student s tímto číslem už existuje' });
    }
    throw err;
  }
  res.status(201).json({ ok: true, studentNumber });
});

router.patch('/students/:studentNumber/password', async (req, res) => {
  const { studentNumber } = req.params;
  const { password } = req.body ?? {};
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);
  if (!isValidPassword(password)) return res.status(400).json(BAD_PASSWORD);

  const student = await Student.findOneAndUpdate(
    { studentNumber },
    { passwordHash: await hashPassword(password) }
  );
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  await destroyStudentSessions(student.id);
  res.json({ ok: true });
});

router.delete('/students/:studentNumber', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOneAndDelete({ studentNumber });
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  await Lesson.updateMany(
    { students: student._id },
    { $pull: { students: student._id }, $inc: { count: -1 } }
  );

  await LessonRecord.deleteMany({ student: student._id });
  await Progress.deleteOne({ student: student._id });

  await destroyStudentSessions(student.id);
  res.json({ ok: true });
});

// Změna jména
router.patch('/students/:studentNumber/name', async (req, res) => {
  const { studentNumber } = req.params;
  const { name } = req.body ?? {};
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);
  if (!isName(name)) return res.status(400).json({ error: 'Jméno musí mít 1 až 100 znaků' });

  const result = await Student.updateOne({ studentNumber }, { name: name.trim() });
  if (!result.matchedCount) return res.status(404).json({ error: 'Student nenalezen' });
  res.json({ ok: true });
});

// Lekce studenta včetně docházky a platby
router.get('/students/:studentNumber/lessons', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOne({ studentNumber }).select('studentNumber name').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const [lessons, records] = await Promise.all([
    Lesson.find({ students: student._id }).select('-_id lecturer date hour').sort({ date: 1, hour: 1 }).lean(),
    LessonRecord.find({ student: student._id }).select('-_id lecturer date hour attended paid').lean(),
  ]);
  const recordMap = new Map(records.map((r) => [`${r.lecturer}|${r.date}|${r.hour}`, r]));
  const today = todayInPrague();

  res.json({
    student: { studentNumber: student.studentNumber, name: student.name },
    lessons: lessons.map((l) => {
      const record = recordMap.get(`${l.lecturer}|${l.date}|${l.hour}`);
      return {
        lecturer: l.lecturer,
        date: l.date,
        hour: l.hour,
        past: l.date <= today, // proběhlá je lekce už v den konání
        attended: record?.attended ?? null,
        paid: record?.paid ?? false,
      };
    }),
  });
});


// Zápis docházky a plateb za více lekcí najednou
router.put('/students/:studentNumber/lessons/records', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const records = req.body?.records;
  if (!Array.isArray(records) || !records.length || records.length > 200) {
    return res.status(400).json({ error: 'Neplatný seznam změn' });
  }

  const today = todayInPrague();
  const items = [];
  for (const r of records) {
    const { lecturer, date, hour, attended, paid } = r ?? {};
    if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer)) {
      return res.status(400).json({ error: 'Neznámý lektor' });
    }
    if (!isValidDate(date)) return res.status(400).json({ error: 'Neplatné datum' });
    if (!Number.isInteger(hour) || hour < 8 || hour > 20) {
      return res.status(400).json({ error: 'Neplatná hodina' });
    }

    const update = {};
    if (attended !== undefined) {
      if (attended !== null && typeof attended !== 'boolean') {
        return res.status(400).json({ error: 'Neplatná docházka' });
      }
      if (attended !== null && date > today) {
        return res.status(400).json({ error: 'Docházku lze zapsat až od dne konání lekce' });
      }
      update.attended = attended;
    }
    if (paid !== undefined) {
      if (typeof paid !== 'boolean') return res.status(400).json({ error: 'Neplatná hodnota platby' });
      update.paid = paid;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nic k uložení' });
    items.push({ lecturer, date, hour, update });
  }

  const student = await Student.findOne({ studentNumber }).select('_id').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  // Všechny lekce musí být opravdu studentovy (mohl je mezitím zrušit)
  const found = await Lesson.find({
    students: student._id,
    $or: items.map(({ lecturer, date, hour }) => ({ lecturer, date, hour })),
  })
    .select('lecturer date hour')
    .lean();
  const owned = new Set(found.map((l) => `${l.lecturer}|${l.date}|${l.hour}`));
  if (!items.every((i) => owned.has(`${i.lecturer}|${i.date}|${i.hour}`))) {
    return res.status(409).json({ error: 'Student už na některé z lekcí není přihlášen, obnovte stránku' });
  }

  await LessonRecord.bulkWrite(
    items.map((i) => ({
      updateOne: {
        filter: { student: student._id, lecturer: i.lecturer, date: i.date, hour: i.hour },
        update: { $set: i.update },
        upsert: true,
      },
    }))
  );
  res.json({ ok: true });
});

const MAX_PAST_LESSONS = 1000;

// Přehled všech proběhlých lekcí (jeden řádek = jeden student na jedné lekci)
router.get('/lessons/past', async (req, res) => {
  const today = todayInPrague();
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const lecturer = str(req.query.lecturer);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const paid = req.query.paid === 'yes' || req.query.paid === 'no' ? req.query.paid : null;

  if (lecturer && !LECTURERS.includes(lecturer)) return res.status(400).json({ error: 'Neznámý lektor' });
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return res.status(400).json({ error: 'Neplatné datum' });
  }

  // Proběhlá = dnes nebo dříve
  const dateFilter = { $lte: to && to < today ? to : today };
  if (from) dateFilter.$gte = from;

  const lessonFilter = { date: dateFilter, count: { $gt: 0 } };
  const recordFilter = { date: dateFilter };
  if (lecturer) {
    lessonFilter.lecturer = lecturer;
    recordFilter.lecturer = lecturer;
  }

  const lessons = await Lesson.find(lessonFilter)
    .select('lecturer date hour students')
    .sort({ date: -1, hour: -1, lecturer: 1 })
    .limit(MAX_PAST_LESSONS)
    .populate('students', 'studentNumber name')
    .lean();

  const records = await LessonRecord.find(recordFilter)
    .select('student lecturer date hour attended paid')
    .lean();
  const recordMap = new Map(records.map((r) => [`${r.student}|${r.lecturer}|${r.date}|${r.hour}`, r]));

  const rows = [];
  for (const l of lessons) {
    const students = l.students.filter(Boolean).sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
    for (const s of students) {
      const rec = recordMap.get(`${s._id}|${l.lecturer}|${l.date}|${l.hour}`);
      const isPaid = rec?.paid ?? false;
      if ((paid === 'yes' && !isPaid) || (paid === 'no' && isPaid)) continue;
      rows.push({
        date: l.date,
        hour: l.hour,
        lecturer: l.lecturer,
        studentNumber: s.studentNumber,
        name: s.name,
        attended: rec?.attended ?? null,
        paid: isPaid,
      });
    }
  }

  res.json({ rows, truncated: lessons.length === MAX_PAST_LESSONS });
});


// Postup studenta v kurzu
router.get('/students/:studentNumber/progress', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOne({ studentNumber }).select('studentNumber name').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const doc = await Progress.findOne({ student: student._id }).lean();
  res.json({
    student: { studentNumber: student.studentNumber, name: student.name },
    ...buildProgress(doc),
  });
});

// Uložení celého postupu studenta najednou
router.put('/students/:studentNumber/progress', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const { sections, tests } = req.body ?? {};
  if (
    !Array.isArray(sections) || !Array.isArray(tests) ||
    sections.length > 500 || tests.length > 50 ||
    !sections.every((id) => typeof id === 'string' && SECTION_LEVEL.has(id)) ||
    !tests.every((level) => Number.isInteger(level) && LEVEL_DEFS.has(level))
  ) {
    return res.status(400).json({ error: 'Neplatná data postupu' });
  }

  const done = new Set(sections);
  const passed = [...new Set(tests)].sort((a, b) => a - b);
  for (const level of passed) {
    if (!LEVEL_DEFS.get(level).sections.every((s) => done.has(s.id))) {
      return res.status(409).json({
        error: `Test levelu ${level} nelze uložit, dokud nejsou splněny všechny podúkoly`,
      });
    }
  }

  const student = await Student.findOne({ studentNumber }).select('_id').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  await applyProgressUpdate(
    student._id,
    { $set: { sections: [...done], tests: passed } },
    { upsert: true }
  );
  res.json({ ok: true });
});


export default router;