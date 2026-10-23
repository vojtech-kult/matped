import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Admin } from '../models/Admin.js';
import { Student } from '../models/Student.js';
import { verifyPassword } from '../utils/password.js';
import { startSession, endSession } from '../utils/session.js';
import { isStudentNumber } from '../utils/validate.js';

const router = Router();

// Max. 10 neúspěšných pokusů za 15 minut z jedné IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Příliš mnoho pokusů, zkuste to později.' },
});

const INVALID = { error: 'Neplatné přihlašovací údaje' };
const MAX_PASSWORD_LENGTH = 200;

router.post('/admin/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(401).json(INVALID);
  }

  const admin = await Admin.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
  if (!(await verifyPassword(password, admin?.passwordHash))) {
    return res.status(401).json(INVALID);
  }

  await startSession(req, { userId: admin.id, role: 'admin' });
  res.json({ ok: true, redirect: '/admin' });
});

router.post('/student/login', loginLimiter, async (req, res) => {
  const { studentNumber, password } = req.body ?? {};
  if (!isStudentNumber(studentNumber) || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(401).json(INVALID);
  }

  const student = await Student.findOne({ studentNumber }).select('+passwordHash');
  if (!(await verifyPassword(password, student?.passwordHash))) {
    return res.status(401).json(INVALID);
  }

  await startSession(req, { userId: student.id, role: 'student' });
  res.json({ ok: true, redirect: '/student' });
});

// Společné odhlášení pro admina i studenta
router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const { userId, role } = req.session ?? {};
  if (!userId) return res.status(401).json({ error: 'Nepřihlášen' });

  const user = role === 'admin' ? await Admin.findById(userId) : await Student.findById(userId);
  if (!user) {
    await endSession(req, res);
    return res.status(401).json({ error: 'Nepřihlášen' });
  }
  res.json({ role, identifier: role === 'admin' ? user.email : user.studentNumber });
});

export default router;