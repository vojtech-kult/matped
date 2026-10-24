import { Router } from 'express';
import { Student } from '../models/Student.js';
import { requireRole } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { isCredits } from '../utils/validate.js';
import { destroyStudentSessions } from '../utils/session.js';
import { isStudentNumber, isValidPassword, isName } from '../utils/validate.js';
import { Lesson } from '../models/Lesson.js';
import { LessonRecord } from '../models/LessonRecord.js';
import { LECTURERS, CAPACITY } from '../config/schedule.js';
import { isValidDate, todayInPrague } from '../utils/calendar.js';
import { Progress } from '../models/Progress.js';
import { buildProgress, applyProgressUpdate } from '../utils/progress.js';
import { saveTrackProgress, curriculumOf } from '../utils/progress.js';
import { CURRICULUM_KEYS } from '../config/tracks.js';

const router = Router();

// Všechny routy v tomto souboru vyžadují přihlášeného admina
router.use(requireRole('admin'));

const BAD_NUMBER = { error: 'Číslo studenta musí mít přesně 6 číslic' };
const BAD_PASSWORD = { error: 'Heslo musí mít 8 až 72 znaků' };
const BAD_CREDITS = { error: 'Kredity musí být celé číslo 0 až 100 000' };

router.get('/students', async (req, res) => {
  const students = await Student.find()
    .sort({ studentNumber: 1 })
    .select('studentNumber name createdAt credits curriculum')
    .lean();

  const progressDocs = await Progress.find({ student: { $in: students.map((s) => s._id) } })
    .select('student sections tests')
    .lean();
  const byStudent = new Map(progressDocs.map((p) => [String(p.student), p]));

  res.json(
    students.map((s) => {
      const progress = buildProgress(byStudent.get(String(s._id)), curriculumOf(s));
      const level = progress.levels.find((l) => l.level === progress.currentLevel);
      return {
        studentNumber: s.studentNumber,
        name: s.name,
        createdAt: s.createdAt,
        curriculum: curriculumOf(s),
        level: progress.currentLevel, // null = kurz dokončen
        levelPercent: level ? level.percent : 100,
        courseCompleted: progress.courseCompleted,
        credits: s.credits ?? 0,
      };
    })
  );
});

router.post('/students', async (req, res) => {
  const { studentNumber, name, password } = req.body ?? {};
  const credits = req.body?.credits ?? 0;
  const curriculum = req.body?.curriculum ?? 'prijimacky';
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);
  if (!isName(name)) return res.status(400).json({ error: 'Jméno musí mít 1 až 100 znaků' });
  if (!isValidPassword(password)) return res.status(400).json(BAD_PASSWORD);
  if (!isCredits(credits)) return res.status(400).json(BAD_CREDITS);
  if (!CURRICULUM_KEYS.includes(curriculum)) return res.status(400).json({ error: 'Neplatné kurikulum' });

  try {
    await Student.create({
      studentNumber,
      name: name.trim(),
      credits,
      curriculum,
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

router.patch('/students/:studentNumber', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const { name, creditsDelta } = req.body ?? {};
  const set = {};
  const filter = { studentNumber };
  const update = {};

  if (name !== undefined) {
    if (!isName(name)) return res.status(400).json({ error: 'Jméno musí mít 1 až 100 znaků' });
    set.name = name.trim();
  }
  if (creditsDelta !== undefined && creditsDelta !== 0) {
    if (!Number.isInteger(creditsDelta) || Math.abs(creditsDelta) > 100000) {
      return res.status(400).json({ error: 'Změna kreditů musí být celé číslo' });
    }
    // Podmínka ve filtru hlídá, aby počet kreditů nešel pod 0 ani nad 100 000
    filter.credits = creditsDelta < 0 ? { $gte: -creditsDelta } : { $lte: 100000 - creditsDelta };
    update.$inc = { credits: creditsDelta };
  }
  if (req.body?.curriculum !== undefined) {
    if (!CURRICULUM_KEYS.includes(req.body.curriculum)) return res.status(400).json({ error: 'Neplatné kurikulum' });
    set.curriculum = req.body.curriculum;
  }
  if (Object.keys(set).length) update.$set = set;
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nic k uložení' });

  const result = await Student.updateOne(filter, update);
  if (!result.matchedCount) {
    if (!(await Student.exists({ studentNumber }))) return res.status(404).json({ error: 'Student nenalezen' });
    return res.status(409).json({ error: 'Kredity nelze změnit: student by měl méně než 0 nebo více než 100 000' });
  }
  res.json({ ok: true });
});

router.delete('/students/:studentNumber', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOneAndDelete({ studentNumber });
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  // uvolní jeho místa v lekcích a smaže navázaná data
  await Lesson.updateMany(
    { students: student._id },
    { $pull: { students: student._id }, $inc: { count: -1 } }
  );
  await Promise.all([
    LessonRecord.deleteMany({ student: student._id }),
    Progress.deleteMany({ student: student._id }),
  ]);
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

const MAX_LESSONS = 1000;

// Seznam lekcí: scope=past (do dneška včetně) nebo upcoming (od zítřka)
router.get('/lessons', async (req, res) => {
  const scope = req.query.scope === 'upcoming' ? 'upcoming' : 'past';
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const lecturer = str(req.query.lecturer);
  const from = str(req.query.from);
  const to = str(req.query.to);

  if (lecturer && !LECTURERS.includes(lecturer)) return res.status(400).json({ error: 'Neznámý lektor' });
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return res.status(400).json({ error: 'Neplatné datum' });
  }

  const today = todayInPrague();
  const range = {};
  if (scope === 'past') range.$lte = to && to < today ? to : today;
  else {
    range.$gt = today;
    if (to) range.$lte = to;
  }
  if (from) range.$gte = from;

  const filter = { date: range, count: { $gt: 0 } };
  if (lecturer) filter.lecturer = lecturer;

  const lessons = await Lesson.find(filter)
    .select('lecturer date hour students')
    .sort(scope === 'past' ? { date: -1, hour: -1, lecturer: 1 } : { date: 1, hour: 1, lecturer: 1 })
    .limit(MAX_LESSONS)
    .populate('students', 'studentNumber name')
    .lean();

  let recordMap = new Map();
  if (scope === 'past') {
    const recordFilter = { date: range };
    if (lecturer) recordFilter.lecturer = lecturer;
    const records = await LessonRecord.find(recordFilter).select('student lecturer date hour attended').lean();
    recordMap = new Map(records.map((r) => [`${r.student}|${r.lecturer}|${r.date}|${r.hour}`, r]));
  }

  res.json({
    truncated: lessons.length === MAX_LESSONS,
    lessons: lessons.map((l) => ({
      lecturer: l.lecturer,
      date: l.date,
      hour: l.hour,
      students: l.students
        .filter(Boolean)
        .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber))
        .map((s) => ({
          studentNumber: s.studentNumber,
          name: s.name,
          attended: recordMap.get(`${s._id}|${l.lecturer}|${l.date}|${l.hour}`)?.attended ?? null,
        })),
    })),
  });
});

// Přehled jedné lekce
router.get('/lessons/detail', async (req, res) => {
  const { lecturer, date } = req.query;
  const hour = Number(req.query.hour);
  if (typeof lecturer !== 'string' || !LECTURERS.includes(lecturer) || !isValidDate(date) ||
      !Number.isInteger(hour) || hour < 8 || hour > 20) {
    return res.status(400).json({ error: 'Neplatná lekce' });
  }

  const lesson = await Lesson.findOne({ lecturer, date, hour })
    .select('students')
    .populate('students', 'studentNumber name')
    .lean();
  const students = (lesson?.students ?? []).filter(Boolean);
  if (!students.length) return res.status(404).json({ error: 'Lekce nenalezena nebo na ní nejsou přihlášení studenti' });

  const records = await LessonRecord.find({ lecturer, date, hour }).select('student attended').lean();
  const attendance = new Map(records.map((r) => [String(r.student), r.attended]));

  res.json({
    lecturer, date, hour,
    past: date <= todayInPrague(),
    capacity: CAPACITY,
    students: students
      .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber))
      .map((s) => ({
        studentNumber: s.studentNumber,
        name: s.name,
        attended: attendance.get(String(s._id)) ?? null,
      })),
  });
});


router.get('/students/:studentNumber/progress', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOne({ studentNumber }).select('studentNumber name curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const doc = await Progress.findOne({ student: student._id }).lean();
  res.json({
    student: { studentNumber: student.studentNumber, name: student.name },
    ...buildProgress(doc, curriculumOf(student)),
  });
});

router.put('/students/:studentNumber/progress', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOne({ studentNumber }).select('_id curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const { sections, tests } = req.body ?? {};
  const error = await saveTrackProgress(student._id, curriculumOf(student), sections, tests);
  if (error) return res.status(error.startsWith('Student má') ? 409 : 400).json({ error });
  res.json({ ok: true });
});


export default router;