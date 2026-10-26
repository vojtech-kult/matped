// Záznam pokroku studenta po lekcích: co se v dané lekci splnilo (nebo odznačilo).
// Ukládá se do LessonRecord.progress; čistý rozdíl za celou lekci, i když se uložilo víckrát.
import { TRACKS, CURRICULUM_LABELS } from '../config/tracks.js';
import { LessonRecord } from '../models/LessonRecord.js';

const EMPTY = (curriculum) => ({ curriculum, sectionsAdded: [], sectionsRemoved: [], testsAdded: [], testsRemoved: [] });

export const isEmptyLog = (log) =>
  !log || !(log.sectionsAdded?.length || log.sectionsRemoved?.length || log.testsAdded?.length || log.testsRemoved?.length);

// Postup studenta v jednom kurikulu: { sections: Set<id>, tests: Set<číslo levelu> }
export function trackSnapshot(doc, curriculum) {
  const track = TRACKS[curriculum];
  if (!track) return { sections: new Set(), tests: new Set() };
  const ids = new Set(track.levels.flatMap((l) => l.sections.map((s) => s.id)));
  const levels = new Set(track.levels.map((l) => l.level));
  return {
    sections: new Set((doc?.sections ?? []).filter((id) => ids.has(id))),
    tests: new Set((doc?.tests ?? []).map((key) => key - track.testOffset).filter((level) => levels.has(level))),
  };
}

// K dosavadnímu záznamu lekce přičte jednu změnu (z „prev“ na „next“) tak, aby zůstal čistý rozdíl
export function mergeLog(log, curriculum, prev, next) {
  const base = log && log.curriculum === curriculum ? log : EMPTY(curriculum);
  const apply = (addedList, removedList, was, now) => {
    const added = new Set(addedList);
    const removed = new Set(removedList);
    for (const x of now) {
      if (was.has(x)) continue;
      if (!removed.delete(x)) added.add(x); // splněno znovu = původní stav obnoven
    }
    for (const x of was) {
      if (now.has(x)) continue;
      if (!added.delete(x)) removed.add(x); // odznačeno znovu = původní stav obnoven
    }
    return [[...added], [...removed]];
  };
  const [sectionsAdded, sectionsRemoved] = apply(base.sectionsAdded, base.sectionsRemoved, prev.sections, next.sections);
  const [testsAdded, testsRemoved] = apply(base.testsAdded, base.testsRemoved, prev.tests, next.tests);
  return {
    curriculum,
    sectionsAdded,
    sectionsRemoved,
    testsAdded: testsAdded.sort((a, b) => a - b),
    testsRemoved: testsRemoved.sort((a, b) => a - b),
  };
}

// Zapíše změnu postupu k dané lekci a studentovi
export async function logLessonProgress(studentId, { lecturer, date, hour }, curriculum, prev, next) {
  const filter = { student: studentId, lecturer, date, hour };
  const record = await LessonRecord.findOne(filter).select('progress').lean();
  const log = mergeLog(record?.progress, curriculum, prev, next);
  if (!record && isEmptyLog(log)) return; // není co zaznamenat
  await LessonRecord.updateOne(filter, { $set: { progress: log } }, { upsert: true });
}

// Záznam doplněný o názvy podtémat a levelů (podle aktuálního kurikula) pro zobrazení
export function describeLog(log) {
  if (isEmptyLog(log)) return null;
  const track = TRACKS[log.curriculum];
  const order = new Map();
  const sections = new Map();
  const levels = new Map();
  for (const l of track?.levels ?? []) {
    levels.set(l.level, l.title);
    for (const s of l.sections) {
      order.set(s.id, order.size);
      sections.set(s.id, { title: s.title, level: l.level, levelTitle: l.title });
    }
  }
  const section = (id) => ({ id, title: null, level: null, levelTitle: null, ...sections.get(id) }); // title null = podtéma už neexistuje
  const bySection = (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9);
  const test = (level) => ({ level, title: levels.get(level) ?? null });
  return {
    curriculum: log.curriculum,
    label: CURRICULUM_LABELS[log.curriculum] ?? log.curriculum,
    sectionsAdded: log.sectionsAdded.map(section).sort(bySection),
    sectionsRemoved: log.sectionsRemoved.map(section).sort(bySection),
    testsAdded: log.testsAdded.map(test),
    testsRemoved: log.testsRemoved.map(test),
  };
}