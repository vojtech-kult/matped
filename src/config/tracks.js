// Kurikula, ze kterých si lze pro studenta vybrat. Kurikulum „vlastni“ nemá žádné levely.
// Přijímačky jsou v curriculum.js (beze změny), maturita v curriculum-maturita.js.
import { CURRICULUM as PRIJIMACKY } from './curriculum.js';
import { MATURITA } from './curriculum-maturita.js';

// Maturitní ID podúkolů dostanou předponu, aby se nikdy nesrazila s přijímačkovými
const maturitaLevels = MATURITA.map((l) => ({
  ...l,
  sections: l.sections.map((s) => ({ ...s, id: `m-${s.id}` })),
}));

// testOffset: testy se v databázi ukládají jako číslo levelu + offset, aby se testy
// přijímaček a maturity nepletly (přijímačky 1–10, maturita 101–110)
export const TRACKS = {
  prijimacky: { label: 'Přijímačky', levels: PRIJIMACKY, testOffset: 0 },
  maturita: { label: 'Maturita', levels: maturitaLevels, testOffset: 100 },
};

export const CURRICULUM_KEYS = ['prijimacky', 'maturita', 'vlastni'];
export const DEFAULT_CURRICULUM = 'prijimacky';
export const CURRICULUM_LABELS = { prijimacky: 'Přijímačky', maturita: 'Maturita', vlastni: 'Vlastní' };

const ids = Object.values(TRACKS).flatMap((t) => t.levels.flatMap((l) => l.sections.map((s) => s.id)));
if (new Set(ids).size !== ids.length) throw new Error('tracks.js: duplicitní ID podúkolu');