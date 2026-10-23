import mongoose from 'mongoose';

export const COOKIE_NAME = 'mathped.sid';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hodin

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

// Při přihlášení vždy vytvoříme novou session (ochrana proti session fixation)
export function startSession(req, { userId, role }) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.role = role;
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

export function endSession(req, res) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) return reject(err);
      res.clearCookie(COOKIE_NAME, cookieOptions);
      resolve();
    });
  });
}

// Po smazání studenta nebo změně hesla ho odhlásíme ze všech zařízení
export async function destroyStudentSessions(studentId) {
  await mongoose.connection
    .collection('sessions')
    .deleteMany({ 'session.userId': String(studentId), 'session.role': 'student' });
}