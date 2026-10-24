import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import testRoutes from './routes/test.routes.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { requireJson, requireRolePage } from './middleware/auth.js';
import { COOKIE_NAME, SESSION_TTL_SECONDS, cookieOptions } from './utils/session.js';
import leadsRoutes from './routes/leads.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import studentRoutes from './routes/student.routes.js';
import { servePages } from './utils/components.js';
import examplesRoutes from './routes/examples.routes.js';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET musí být nastaven (min. 32 znaků)');
}

const app = express();

// Za proxy hostingu (Railway/Render) jinak nefunguje secure cookie ani rate limit podle IP
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

export const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  stringify: false, // session jako objekt, aby šlo mazat podle userId
  ttl: SESSION_TTL_SECONDS,
});

app.use(
  session({
    name: COOKIE_NAME,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 },
  })
);

app.use(helmet());
app.use(express.json({ limit: '100kb' }));

// Veřejné soubory (přihlašovací stránky) – před session, ať nezatěžují databázi
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const ADMIN_DIR = path.join(import.meta.dirname, 'views', 'admin');
const STUDENT_DIR = path.join(import.meta.dirname, 'views', 'student');

// Veřejné stránky: nejdřív renderer komponent, pak ostatní soubory (js, css)
app.use(servePages(PUBLIC_DIR));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.use(
  '/vendor/katex',
  express.static(path.join(import.meta.dirname, '..', 'node_modules', 'katex', 'dist'), { index: false })
);

app.use(
  session({
    name: COOKIE_NAME,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      stringify: false, // session jako objekt, aby šlo mazat podle userId
      ttl: SESSION_TTL_SECONDS,
    }),
    cookie: { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 },
  })
);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', requireJson);
app.use('/api/test', testRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin/availability', availabilityRoutes); 
app.use('/api/admin/examples', examplesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);  

// Staré adresy stránek vedou na nové (se zachováním ?number=...)
const keepQuery = (req) =>
  req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';

app.get(['/admin/student-detail.html', '/admin/student-progress.html'], (req, res) =>
  res.redirect(302, `/admin/students.html${keepQuery(req)}`)
);
app.get('/admin/schedule.html', (req, res) => res.redirect(302, '/admin/'));

// Chráněné stránky: bez správné role přesměrování na přihlášení
app.use(
  '/admin',
  requireRolePage('admin', '/admin-login.html'),
  servePages(ADMIN_DIR),
  express.static(ADMIN_DIR, { index: false })
);
app.use(
  '/student',
  requireRolePage('student', '/student-login.html'),
  servePages(STUDENT_DIR),
  express.static(STUDENT_DIR, { index: false })
);

app.use((req, res) => res.status(404).json({ error: 'Nenalezeno' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Neplatný JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Interní chyba serveru' });
});

export default app;