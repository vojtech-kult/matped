import { Lesson } from '../models/Lesson.js';
import '../models/Student.js'; // registrace modelu kvůli populate
import { DailyReport } from '../models/DailyReport.js';
import { LECTURERS, LECTURER_DISCORD_IDS } from '../config/schedule.js';
import { hourInPrague, todayInPrague } from './calendar.js';

const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 12; // po 12:00 se zmeškaná zpráva už neposílá
const MESSAGE_LIMIT = 1900; // Discord: max. 2000 znaků na zprávu
const LEASE_MS = 2 * 60 * 1000;
const SNOWFLAKE_RE = /^\d{17,20}$/;

const escapeMd = (s) => s.replace(/([\\*_~`|>])/g, '\\$1');

function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

function lecturerId(name) {
  const id = LECTURER_DISCORD_IDS[name];
  return typeof id === 'string' && SNOWFLAKE_RE.test(id) ? id : null;
}

// Vrací { messages, mentionIds }, nebo null, když na ten den nejsou žádné lekce s přihlášeným studentem
export async function buildReport(date) {
  const lessons = await Lesson.find({ date, count: { $gt: 0 } })
    .select('lecturer hour students')
    .populate('students', 'studentNumber name')
    .lean();

  const byLecturer = new Map();
  for (const lesson of lessons) {
    const students = lesson.students
      .filter(Boolean)
      .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
    if (!students.length) continue;
    if (!byLecturer.has(lesson.lecturer)) byLecturer.set(lesson.lecturer, []);
    byLecturer.get(lesson.lecturer).push({ hour: lesson.hour, students });
  }
  if (!byLecturer.size) return null;

  const rank = (name) => {
    const i = LECTURERS.indexOf(name);
    return i === -1 ? LECTURERS.length : i;
  };
  const lecturers = [...byLecturer.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const mentionIds = [];
  const parts = []; // { gap: oddělovač před částí, text }
  for (const lecturer of lecturers) {
    const id = lecturerId(lecturer);
    if (id) mentionIds.push(id);
    const who = id ? `<@${id}>` : `**${escapeMd(lecturer)}**`;

    const hours = byLecturer.get(lecturer).sort((a, b) => a.hour - b.hour);
    hours.forEach(({ hour, students }, i) => {
      const lines = students
        .map((s) => `* ${escapeMd(s.name || 'bez jména')} (${s.studentNumber})`)
        .join('\n');
      const heading = i === 0 ? `Lektor ${who}:\n\n` : '';
      const gap = parts.length === 0 ? '\n\n' : i === 0 ? '\n\n\n' : '\n\n';
      parts.push({ gap, text: `${heading}${hour}:00 - ${hour}:50\n${lines}` });
    });
  }

  // Poskládání do zpráv do 1900 znaků (hlavička je v první)
  const messages = [];
  let current = `${formatDate(date)}\n**Naplánované lekce na dnešní den:**`;
  for (const part of parts) {
    const next = current + part.gap + part.text;
    if (next.length > MESSAGE_LIMIT) {
      messages.push(current);
      current = part.text.slice(0, MESSAGE_LIMIT);
    } else {
      current = next;
    }
  }
  messages.push(current);

  return { date, messages, mentionIds: [...new Set(mentionIds)] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postMessage(content, mentionIds) {
  const url = process.env.DISCORD_DAILY_WEBHOOK_URL;
  if (!url) throw new Error('DISCORD_DAILY_WEBHOOK_URL není nastaven');

  const body = JSON.stringify({
    username: 'MatPed schedule notifier',
    content,
    // Pingnou se jen lektoři z konfigurace, nikdo jiný (ani @everyone ze jména studenta)
    allowed_mentions: { parse: [], users: mentionIds },
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return;

    if (res.status === 429 && attempt === 1) {
      const data = await res.json().catch(() => ({}));
      await sleep(Math.min((data.retry_after ?? 1) * 1000, 5000));
      continue;
    }
    throw new Error(`Discord odpověděl stavem ${res.status}`);
  }
}

// Odešle přehled za daný den, nejvýše jednou. Vrací 'sent' | 'empty' | 'skipped'.
export async function sendDailyReport(date) {
  const now = new Date();

  // Atomický zámek: uspěje jen, když den ještě není hotový a nikdo jiný právě neodesílá.
  // Jinak upsert narazí na unikátní index (11000).
  let doc;
  try {
    doc = await DailyReport.findOneAndUpdate(
      { date, done: { $ne: true }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false }
    );
  } catch (err) {
    if (err.code === 11000) return 'skipped';
    throw err;
  }

  try {
    const report = await buildReport(date);
    if (report) {
      // Při opakování po chybě se už odeslané zprávy nepošlou znovu
      for (let i = doc.sent ?? 0; i < report.messages.length; i++) {
        await postMessage(report.messages[i], report.mentionIds);
        await DailyReport.updateOne({ _id: doc._id }, { $set: { sent: i + 1 } });
      }
    }
    await DailyReport.updateOne(
      { _id: doc._id },
      { $set: { done: true, sentAt: new Date() }, $unset: { lockedUntil: '' } }
    );
    return report ? 'sent' : 'empty';
  } catch (err) {
    await DailyReport.updateOne({ _id: doc._id }, { $unset: { lockedUntil: '' } }).catch(() => {});
    throw err; // příští minutu se to zkusí znovu
  }
}

/* ---------- časovač ---------- */

let running = false;
let handledDate = null;

async function tick() {
  const hour = hourInPrague();
  if (running || hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return;

  const date = todayInPrague();
  if (handledDate === date) return;

  running = true;
  try {
    const result = await sendDailyReport(date);
    if (result === 'sent') console.log(`Denní přehled lekcí odeslán (${date}).`);
    if (result !== 'skipped') handledDate = date;
  } catch (err) {
    console.error('Denní přehled lekcí se nepodařilo odeslat:', err.message);
  } finally {
    running = false;
  }
}

export function startDailyReportScheduler() {
  if (process.env.DAILY_REPORT_ENABLED !== 'true') {
    console.log('Denní přehled lekcí na Discord je vypnutý (DAILY_REPORT_ENABLED).');
    return;
  }
  if (!process.env.DISCORD_DAILY_WEBHOOK_URL) {
    console.warn('Denní přehled lekcí: chybí DISCORD_DAILY_WEBHOOK_URL, časovač se nespouští.');
    return;
  }
  console.log('Denní přehled lekcí na Discord je zapnutý (každý den od 8:00).');
  tick();
  setInterval(tick, 60_000);
}