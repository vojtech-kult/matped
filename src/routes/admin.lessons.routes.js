import { Router } from 'express';
import { Student } from '../models/Student.js';
import { Lesson } from '../models/Lesson.js';
import { LessonRecord } from '../models/LessonRecord.js';
import { Progress } from '../models/Progress.js';
import { LECTURERS, CAPACITY } from '../config/schedule.js';
import { isValidDate, todayInPrague } from '../utils/calendar.js';
import { isStudentNumber } from '../utils/validate.js';
import { curriculumOf, saveTrackProgress } from '../utils/progress.js';
import { trackSnapshot, logLessonProgress, describeLog } from '../utils/lessonProgress.js';

// Připojuje se v admin.routes.js hned za requireRole('admin'): router.use(lessonRoutes);
// Obsahuje trojici rout, které se týkají detailu lekce: zápis docházky/plateb/poznámek, přehled lekce a uložení postupu.
const router = Router();

const BAD_NUMBER = { error: 'Číslo studenta musí mít přesně 6 číslic' };
const MAX_NOTE = 2000;

const isLessonRef = ({ lecturer, date, hour } = {}) =>
  typeof lecturer === 'string' && LECTURERS.includes(lecturer) && isValidDate(date) && Number.isInteger(hour) && hour >= 8 && hour <= 20;

// Zápis docházky, plateb a poznámek za více lekcí najednou
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
    const { lecturer, date, hour, attended, paid, note } = r ?? {};
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
    if (note !== undefined) {
      if (typeof note !== 'string' || note.length > MAX_NOTE) {
        return res.status(400).json({ error: `Poznámka může mít nejvýše ${MAX_NOTE} znaků` });
      }
      update.note = note.trim();
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

// Přehled jedné lekce: studenti, docházka, poznámky a pokrok zaznamenaný v této lekci
router.get('/lessons/detail', async (req, res) => {
  const { lecturer, date } = req.query;
  const hour = Number(req.query.hour);
  if (!isLessonRef({ lecturer, date, hour })) return res.status(400).json({ error: 'Neplatná lekce' });

  const lesson = await Lesson.findOne({ lecturer, date, hour })
    .select('students')
    .populate('students', 'studentNumber name')
    .lean();
  const students = (lesson?.students ?? []).filter(Boolean);
  if (!students.length) return res.status(404).json({ error: 'Lekce nenalezena nebo na ní nejsou přihlášení studenti' });

  const records = await LessonRecord.find({ lecturer, date, hour }).select('student attended note progress').lean();
  const byStudent = new Map(records.map((r) => [String(r.student), r]));

  res.json({
    lecturer, date, hour,
    past: date <= todayInPrague(),
    capacity: CAPACITY,
    students: students
      .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber))
      .map((s) => {
        const record = byStudent.get(String(s._id));
        return {
          studentNumber: s.studentNumber,
          name: s.name,
          attended: record?.attended ?? null,
          note: record?.note ?? '',
          progress: describeLog(record?.progress),
        };
      }),
  });
});

// Uložení postupu studenta; s „lesson“ se změna zároveň zapíše k dané lekci
router.put('/students/:studentNumber/progress', async (req, res) => {
  const { studentNumber } = req.params;
  if (!isStudentNumber(studentNumber)) return res.status(400).json(BAD_NUMBER);

  const student = await Student.findOne({ studentNumber }).select('_id curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const { sections, tests, lesson } = req.body ?? {};
  const curriculum = curriculumOf(student);

  let ref = null;
  if (lesson !== undefined) {
    if (!isLessonRef(lesson)) return res.status(400).json({ error: 'Neplatná lekce' });
    if (!(await Lesson.exists({ lecturer: lesson.lecturer, date: lesson.date, hour: lesson.hour, students: student._id }))) {
      return res.status(409).json({ error: 'Student na této lekci není přihlášen, obnovte stránku' });
    }
    ref = { lecturer: lesson.lecturer, date: lesson.date, hour: lesson.hour };
  }

  const before = ref ? trackSnapshot(await Progress.findOne({ student: student._id }).lean(), curriculum) : null;
  const error = await saveTrackProgress(student._id, curriculum, sections, tests);
  if (error) return res.status(error.startsWith('Student má') ? 409 : 400).json({ error });

  if (ref) {
    await logLessonProgress(student._id, ref, curriculum, before, { sections: new Set(sections), tests: new Set(tests) });
  }
  res.json({ ok: true });
});

export default router;