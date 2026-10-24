import { XP_PER_SECTION, XP_PER_TEST } from '../config/curriculum.js';
import { TRACKS, DEFAULT_CURRICULUM, CURRICULUM_LABELS } from '../config/tracks.js';
import { Progress } from '../models/Progress.js';

// Kurikulum studenta; chybějící hodnota (starší studenti) = přijímačky
export const curriculumOf = (student) => student?.curriculum ?? DEFAULT_CURRICULUM;
export const trackOf = (curriculum) => TRACKS[curriculum] ?? null; // null = „vlastni“, level systém neběží

const testKey = (track, level) => level + track.testOffset;
const ownsTest = (track, key) => key > track.testOffset && key <= track.testOffset + 99;

export const sectionLevels = (track) =>
  new Map(track.levels.flatMap((l) => l.sections.map((s) => [s.id, l.level])));
export const levelDefs = (track) => new Map(track.levels.map((l) => [l.level, l]));

// Z uložených dat spočítá stav levelů zvoleného kurikula, aktuální level a XP
export function buildProgress(doc, curriculum = DEFAULT_CURRICULUM) {
  const track = trackOf(curriculum);
  const base = { curriculum, label: CURRICULUM_LABELS[curriculum] ?? curriculum };
  if (!track) {
    return { ...base, enabled: false, levels: [], currentLevel: null, courseCompleted: false, xp: 0, maxXp: 0 };
  }

  const done = new Set(doc?.sections ?? []);
  const passed = new Set(doc?.tests ?? []);
  let xp = 0;

  const levels = track.levels.map((def) => {
    const sections = def.sections.map((s) => ({ id: s.id, title: s.title, done: done.has(s.id) }));
    const doneCount = sections.filter((s) => s.done).length;
    // test se počítá, jen když jsou splněné všechny podúkoly
    const testPassed = doneCount === sections.length && passed.has(testKey(track, def.level));
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

  const maxXp = track.levels.reduce((sum, l) => sum + l.sections.length * XP_PER_SECTION + XP_PER_TEST, 0);
  return {
    ...base,
    enabled: true,
    levels,
    currentLevel: current?.level ?? null,
    courseCompleted: !current,
    xp,
    maxXp,
    xpPerSection: XP_PER_SECTION,
    xpPerTest: XP_PER_TEST,
  };
}

// Nahradí postup studenta v jeho kurikulu, postup v druhém kurikulu zůstane nedotčený.
// Vrací chybovou hlášku nebo null.
export async function saveTrackProgress(studentId, curriculum, sections, tests) {
  const track = trackOf(curriculum);
  if (!track) return 'Student má vlastní kurikulum, level systém není aktivní';

  const sectionLevel = sectionLevels(track);
  const defs = levelDefs(track);
  if (
    !Array.isArray(sections) || !Array.isArray(tests) || sections.length > 500 || tests.length > 50 ||
    !sections.every((id) => typeof id === 'string' && sectionLevel.has(id)) ||
    !tests.every((level) => Number.isInteger(level) && defs.has(level))
  ) {
    return 'Neplatná data postupu';
  }

  const done = new Set(sections);
  const passed = [...new Set(tests)].sort((a, b) => a - b);
  for (const level of passed) {
    if (!defs.get(level).sections.every((s) => done.has(s.id))) {
      return `Test levelu ${level} nelze uložit, dokud nejsou splněny všechny podúkoly`;
    }
  }

  const doc = await Progress.findOne({ student: studentId }).lean();
  const keepSections = (doc?.sections ?? []).filter((id) => !sectionLevel.has(id));
  const keepTests = (doc?.tests ?? []).filter((key) => !ownsTest(track, key));
  const update = {
    $set: {
      sections: [...keepSections, ...done],
      tests: [...keepTests, ...passed.map((level) => testKey(track, level))],
    },
  };
  await applyProgressUpdate(studentId, update, { upsert: true });
  return null;
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