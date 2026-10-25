// Kurikula uložená v databázi. Zbytek aplikace (progress.js) dál čte TRACKS z config/tracks.js,
// takže tady po startu a po každém uložení jen přepíšeme TRACKS[key].levels (bez změny ostatního kódu).
import { TRACKS } from '../config/tracks.js';
import { Curriculum } from '../models/Curriculum.js';

export const EDITABLE = ['prijimacky', 'maturita'];

// Výchozí kurikula z kódu (kopie pořízená dřív, než se cokoli přepíše)
const DEFAULTS = Object.fromEntries(EDITABLE.map((k) => [k, structuredClone(TRACKS[k].levels)]));

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const ID_RE = /^[\w.-]{1,60}$/;

const allVideoIds = (key) =>
  TRACKS[key].levels.flatMap((l) => l.sections.flatMap((s) => (s.videos ?? []).map((v) => v.id).filter(Boolean)));

export function isYoutubeUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && YT_HOSTS.has(u.hostname) && u.pathname.length > 1;
  } catch {
    return false;
  }
}

const text = (v, max) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max ? v.trim() : null);

// Ověří a očistí levely z klienta. Vrací { levels } nebo { error }.
export function normalizeLevels(key, input) {
  const current = TRACKS[key].levels;
  if (!Array.isArray(input) || input.length !== current.length) return { error: 'Neplatný počet levelů' };

  const used = new Set(
    EDITABLE.filter((k) => k !== key).flatMap((k) => TRACKS[k].levels.flatMap((l) => l.sections.map((s) => s.id)))
  );
  // ID videí se drží napříč oběma kurikuly; chybějící ID (starší uložená videa) se dogeneruje
  const usedVideos = new Set(EDITABLE.filter((k) => k !== key).flatMap(allVideoIds));
  const levels = [];

  for (const [i, l] of input.entries()) {
    if (!l || typeof l !== 'object' || l.level !== current[i].level) return { error: 'Neplatná struktura levelů' };
    const title = text(l.title, 100);
    if (!title) return { error: `Level ${l.level}: název musí mít 1 až 100 znaků` };
    if (!Array.isArray(l.sections) || l.sections.length < 1 || l.sections.length > 40) {
      return { error: `Level ${l.level}: musí mít 1 až 40 podtémat` };
    }

    const sections = [];
    for (const s of l.sections) {
      if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id) || used.has(s.id)) {
        return { error: `Level ${l.level}: neplatné nebo duplicitní ID podtématu` };
      }
      used.add(s.id);
      const sTitle = text(s.title, 150);
      if (!sTitle) return { error: `Level ${l.level}: název podtématu musí mít 1 až 150 znaků` };
      if (!Array.isArray(s.videos) || s.videos.length > 20) return { error: `„${sTitle}“: nejvýše 20 videí` };

      const videos = [];
      for (const v of s.videos) {
        const vTitle = text(v?.title, 100);
        const url = typeof v?.url === 'string' ? v.url.trim() : '';
        if (!vTitle) return { error: `„${sTitle}“: název videa musí mít 1 až 100 znaků` };
        if (!isYoutubeUrl(url)) return { error: `„${sTitle}“: video „${vTitle}“ nemá platný odkaz na YouTube` };
        let id = typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : null;
        if (id && usedVideos.has(id)) return { error: `„${sTitle}“: duplicitní ID videa` };
        while (!id || usedVideos.has(id)) id = `v-${Math.random().toString(36).slice(2, 10)}`;
        usedVideos.add(id);
        videos.push({ id, title: vTitle, url });
      }
      sections.push({ id: s.id, title: sTitle, videos });
    }
    levels.push({ level: l.level, title, sections });
  }
  return { levels };
}

// Přepíše živé TRACKS; další vlastnosti z výchozího kurikula (pokud nějaké jsou) se zachovají
export function applyLevels(key, levels) {
  const baseLevel = new Map(DEFAULTS[key].map((l) => [l.level, l]));
  const baseSection = new Map(DEFAULTS[key].flatMap((l) => l.sections.map((s) => [s.id, s])));
  TRACKS[key].levels = levels.map((l) => ({
    ...baseLevel.get(l.level),
    level: l.level,
    title: l.title,
    sections: l.sections.map((s) => ({ ...baseSection.get(s.id), id: s.id, title: s.title, videos: s.videos })),
  }));
}

// Tvar pro klienta
export const toClient = (levels) =>
  levels.map((l) => ({
    level: l.level,
    title: l.title,
    sections: l.sections.map((s) => ({
      id: s.id,
      title: s.title,
      videos: (s.videos ?? []).map((v) => ({ id: v.id, title: v.title, url: v.url })),
    })),
  }));

// Najde video v kurikulu podle ID: { level, section, video } nebo null
export function findVideo(key, videoId) {
  for (const level of TRACKS[key]?.levels ?? []) {
    for (const section of level.sections) {
      const video = section.videos?.find((v) => v.id === videoId);
      if (video) return { level, section, video };
    }
  }
  return null;
}

export const defaultLevels = (key) => toClient(DEFAULTS[key]);

// Volat jednou po připojení k databázi (před app.listen)
export async function loadTracks() {
  const docs = await Curriculum.find({ key: { $in: EDITABLE } }).lean();
  for (const d of docs) {
    const { levels, error } = normalizeLevels(d.key, d.levels);
    if (error) {
      console.error(`Kurikulum ${d.key} v databázi je neplatné (${error}), používám výchozí.`);
      continue;
    }
    applyLevels(d.key, levels);

    // Videa uložená před zavedením ID dostanou ID a uloží se zpět (jednorázová migrace)
    if (d.levels.some((l) => l.sections.some((s) => (s.videos ?? []).some((v) => !v.id)))) {
      await Curriculum.updateOne({ key: d.key, version: d.version }, { $set: { levels }, $inc: { version: 1 } });
    }
  }
}