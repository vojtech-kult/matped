import { CURRICULUM, XP_PER_SECTION, XP_PER_TEST } from '../config/curriculum.js';
import { Progress } from '../models/Progress.js';

export const SECTION_LEVEL = new Map(CURRICULUM.flatMap((l) => l.sections.map((s) => [s.id, l.level])));
export const LEVEL_DEFS = new Map(CURRICULUM.map((l) => [l.level, l]));

// Z uložených dat spočítá stav všech levelů, aktuální level a XP
export function buildProgress(doc) {
  const done = new Set(doc?.sections ?? []);
  const passed = new Set(doc?.tests ?? []);
  let xp = 0;

  const levels = CURRICULUM.map((def) => {
    const sections = def.sections.map((s) => ({ id: s.id, title: s.title, done: done.has(s.id) }));
    const doneCount = sections.filter((s) => s.done).length;
    // test se počítá, jen když jsou splněné všechny podúkoly
    const testPassed = doneCount === sections.length && passed.has(def.level);
    xp += doneCount * XP_PER_SECTION + (testPassed ? XP_PER_TEST : 0);

    return {
      level: def.level,
      title: def.title,
      sections,
      doneCount,
      total: sections.length,
      percent: Math.round((doneCount / sections.length) * 100),
      testPassed,
      completed: testPassed,
    };
  });

  const current = levels.find((l) => !l.completed);
  for (const l of levels) l.status = l.completed ? 'completed' : l === current ? 'current' : 'upcoming';

  const maxXp = CURRICULUM.reduce((sum, l) => sum + l.sections.length * XP_PER_SECTION + XP_PER_TEST, 0);
  return {
    levels,
    currentLevel: current?.level ?? null,
    courseCompleted: !current,
    xp,
    maxXp,
    xpPerSection: XP_PER_SECTION,
    xpPerTest: XP_PER_TEST,
  };
}

// Zápis s jedním opakováním při souběhu dvou prvních zápisů (unikátní index)
export async function applyProgressUpdate(studentId, update, { upsert }) {
  const options = { upsert, setDefaultsOnInsert: false };
  try {
    await Progress.updateOne({ student: studentId }, update, options);
  } catch (err) {
    if (err.code !== 11000 || !upsert) throw err;
    await Progress.updateOne({ student: studentId }, update, options);
  }
}