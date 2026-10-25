const $ = (id) => document.getElementById(id);
const { api, el } = Admin;

const REQUIRED_IDS = ['tabs', 'levels', 'summary', 'expand-all', 'collapse-all', 'savebar', 'save', 'discard', 'dirty'];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) {
  Admin.toast(`Chybí prvky stránky: ${missing.join(', ')}`, true);
  throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);
}

const MAX_VIDEOS = 20;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

function isYoutubeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && YT_HOSTS.has(u.hostname) && u.pathname.length > 1;
  } catch {
    return false;
  }
}

// 1 podtéma, 2–4 podtémata, 5 podtémat
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

const state = {
  key: 'prijimacky',
  version: 0,
  work: [], // pracovní kopie levelů
  snapshot: '', // JSON uložené podoby
  open: new Set(), // rozbalené levely
  videosOpen: new Set(), // podtémata s rozbaleným panelem videí
  focus: null, // CSS selektor prvku, na který se po překreslení nastaví fokus
  busy: false,
};

const isDirty = () => JSON.stringify(state.work) !== state.snapshot;

async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (err) {
    Admin.toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

async function load(key) {
  const data = await api('GET', `/api/admin/curricula/${key}`);
  state.key = key;
  state.version = data.version;
  state.work = data.levels.map((l) => ({
    level: l.level,
    title: l.title,
    sections: l.sections.map((s) => ({
      id: s.id,
      title: s.title,
      videos: (s.videos ?? []).map((v) => ({ id: v.id ?? newVideoId(), title: v.title, url: v.url })),
    })),
  }));
  state.snapshot = JSON.stringify(state.work);
  state.open = new Set(state.work.length ? [state.work[0].level] : []);
  state.videosOpen = new Set();
}

function newSectionId() {
  const used = new Set(state.work.flatMap((l) => l.sections.map((s) => s.id)));
  const prefix = state.key === 'maturita' ? 'm-n-' : 'n-';
  let id;
  do {
    id = prefix + Math.random().toString(36).slice(2, 10);
  } while (used.has(id));
  return id;
}

function newVideoId() {
  const used = new Set(state.work.flatMap((l) => l.sections.flatMap((s) => s.videos.map((v) => v.id))));
  let id;
  do {
    id = `v-${Math.random().toString(36).slice(2, 10)}`;
  } while (used.has(id));
  return id;
}

/* ---------- stavová lišta a souhrn ---------- */

function updateBar() {
  const dirty = isDirty();
  $('savebar').hidden = !dirty;
  $('dirty').textContent = 'Neuložené změny';
  $('save').disabled = state.busy;

  const sections = state.work.reduce((n, l) => n + l.sections.length, 0);
  const videos = state.work.reduce((n, l) => n + l.sections.reduce((m, s) => m + s.videos.length, 0), 0);
  $('summary').textContent =
    `${state.work.length} ${plural(state.work.length, 'level', 'levely', 'levelů')} · ` +
    `${sections} ${plural(sections, 'podtéma', 'podtémata', 'podtémat')} · ` +
    `${videos} ${plural(videos, 'video', 'videa', 'videí')}`;
}

const levelMeta = (level) => {
  const v = level.sections.reduce((n, s) => n + s.videos.length, 0);
  const n = level.sections.length;
  return `${n} ${plural(n, 'podtéma', 'podtémata', 'podtémat')} · ${v} ${plural(v, 'video', 'videa', 'videí')}`;
};

/* ---------- vykreslení ---------- */

function render() {
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === state.key));
  $('levels').replaceChildren(...state.work.map(levelCard));
  updateBar();

  if (state.focus) {
    const node = document.querySelector(state.focus);
    state.focus = null;
    if (node && !node.disabled) {
      node.focus();
      node.scrollIntoView?.({ block: 'nearest' });
    }
  }
}

function iconButton(className, text, label, onClick, disabled = false) {
  const b = el('button', `btn btn-sm cur-icon ${className}`, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function levelCard(level) {
  const isOpen = state.open.has(level.level);
  const card = el('section', 'card cur-level');
  card.dataset.level = level.level;

  const head = el('div', 'cur-level-head');
  const toggle = el('button', 'cur-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', `${isOpen ? 'Sbalit' : 'Rozbalit'} level ${level.level}`);
  toggle.addEventListener('click', () => {
    if (isOpen) state.open.delete(level.level);
    else state.open.add(level.level);
    state.focus = `[data-level="${level.level}"] .cur-toggle`;
    render();
  });

  const title = el('input', 'cur-level-title');
  title.value = level.title;
  title.maxLength = 100;
  title.setAttribute('aria-label', `Název levelu ${level.level}`);
  title.classList.toggle('invalid', !level.title.trim());
  const meta = el('span', 'cur-meta', levelMeta(level));
  title.addEventListener('input', () => {
    level.title = title.value;
    title.classList.toggle('invalid', !title.value.trim());
    updateBar();
  });

  head.append(toggle, el('span', 'cur-num', String(level.level)), title, meta);
  card.append(head);
  if (isOpen) card.append(levelBody(level));
  return card;
}

function levelBody(level) {
  const body = el('div', 'cur-level-body');
  const list = el('ol', 'cur-sections');
  level.sections.forEach((s, i) => list.append(sectionItem(level, s, i)));

  const add = el('button', 'btn btn-sm', '+ Přidat podtéma');
  add.type = 'button';
  add.addEventListener('click', () => addSection(level, level.sections.length));
  body.append(list, add);
  return body;
}

function addSection(level, at) {
  const section = { id: newSectionId(), title: '', videos: [] };
  level.sections.splice(at, 0, section);
  state.focus = `[data-sid="${section.id}"] .cur-sec-title`;
  render();
}

function moveSection(level, i, d) {
  const j = i + d;
  if (j < 0 || j >= level.sections.length) return;
  const id = level.sections[i].id;
  [level.sections[i], level.sections[j]] = [level.sections[j], level.sections[i]];
  // fokus zůstane na stejném tlačítku, pokud je ještě použitelné, jinak na protějším
  const own = d < 0 ? 'cur-up' : 'cur-down';
  const other = d < 0 ? 'cur-down' : 'cur-up';
  state.focus = `[data-sid="${id}"] .${j === 0 || j === level.sections.length - 1 ? other : own}`;
  render();
}

function sectionItem(level, sec, i) {
  const li = el('li', 'cur-section');
  li.dataset.sid = sec.id;
  const row = el('div', 'cur-row');

  const input = el('input', 'cur-sec-title');
  input.value = sec.title;
  input.maxLength = 150;
  input.placeholder = 'Název podtématu';
  input.setAttribute('aria-label', `Název podtématu ${i + 1} v levelu ${level.level}`);
  input.classList.toggle('invalid', !sec.title.trim());
  input.addEventListener('input', () => {
    sec.title = input.value;
    input.classList.toggle('invalid', !input.value.trim());
    updateBar();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSection(level, i + 1);
    }
  });

  const videosOpen = state.videosOpen.has(sec.id);
  const vb = el('button', `btn btn-sm cur-vid-btn${sec.videos.length ? ' has' : ''}`);
  vb.type = 'button';
  vb.setAttribute('aria-expanded', String(videosOpen));
  vb.append('Videa ', el('span', 'cur-count', String(sec.videos.length)));
  vb.addEventListener('click', () => {
    if (videosOpen) state.videosOpen.delete(sec.id);
    else state.videosOpen.add(sec.id);
    state.focus = `[data-sid="${sec.id}"] .cur-vid-btn`;
    render();
  });

  const last = level.sections.length - 1;
  row.append(
    el('span', 'cur-idx', `${i + 1}.`),
    input,
    vb,
    iconButton('cur-up', '↑', 'Posunout nahoru', () => moveSection(level, i, -1), i === 0),
    iconButton('cur-down', '↓', 'Posunout dolů', () => moveSection(level, i, 1), i === last),
    iconButton(
      'cur-del', '✕',
      level.sections.length > 1 ? 'Smazat podtéma' : 'Level musí mít aspoň jedno podtéma',
      () => {
        level.sections.splice(i, 1);
        state.videosOpen.delete(sec.id);
        render();
      },
      level.sections.length <= 1
    )
  );
  li.append(row);
  if (videosOpen) li.append(videosPanel(sec));
  return li;
}

function videosPanel(sec) {
  const box = el('div', 'cur-videos');

  if (!sec.videos.length) box.append(el('p', 'cur-empty', 'K tomuto podtématu zatím nejsou žádná videa.'));
  const list = el('ul', 'cur-video-list');
  sec.videos.forEach((v, i) => list.append(videoItem(sec, v, i)));
  if (sec.videos.length) box.append(list);

  const add = el('button', 'btn btn-sm', '+ Přidat video');
  add.type = 'button';
  add.disabled = sec.videos.length >= MAX_VIDEOS;
  add.addEventListener('click', () => {
    sec.videos.push({ id: newVideoId(), title: '', url: '' });
    state.focus = `[data-sid="${sec.id}"] .cur-video:last-child .cur-v-title`;
    render();
  });
  box.append(add);
  return box;
}

function videoItem(sec, v, i) {
  const li = el('li', 'cur-video');

  const title = el('input', 'cur-v-title');
  title.value = v.title;
  title.maxLength = 100;
  title.placeholder = 'Název videa';
  title.setAttribute('aria-label', `Název videa ${i + 1}`);
  title.addEventListener('input', () => {
    v.title = title.value;
    updateBar();
  });

  const urlWrap = el('div');
  const url = el('input', 'cur-v-url');
  url.type = 'url';
  url.value = v.url;
  url.maxLength = 300;
  url.placeholder = 'https://www.youtube.com/watch?v=…';
  url.setAttribute('aria-label', `Odkaz na YouTube pro video ${i + 1}`);
  const err = el('span', 'cur-url-err');
  err.setAttribute('role', 'alert');
  const open = el('a', 'btn btn-sm cur-icon cur-open', '↗');
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.title = 'Otevřít video v novém okně';
  open.setAttribute('aria-label', 'Otevřít video v novém okně');

  const check = () => {
    const value = url.value.trim();
    const ok = isYoutubeUrl(value);
    const bad = value !== '' && !ok;
    url.classList.toggle('invalid', bad);
    err.textContent = bad ? 'Zadejte platný odkaz na YouTube (https://…).' : '';
    open.hidden = !ok;
    if (ok) open.href = value;
    else open.removeAttribute('href');
  };
  url.addEventListener('input', () => {
    v.url = url.value;
    check();
    updateBar();
  });
  check();
  urlWrap.append(url, err);

  const actions = el('div', 'cur-video-actions');
  actions.append(
    open,
    iconButton('cur-del', '✕', 'Smazat video', () => {
      sec.videos.splice(i, 1);
      render();
    })
  );

  li.append(title, urlWrap, actions);
  return li;
}

/* ---------- uložení ---------- */

// Zkontroluje a očistí pracovní kopii; vrací { levels } nebo { error, level, sid?, focus }
function collect() {
  const levels = [];
  for (const l of state.work) {
    const title = l.title.trim();
    if (!title) return { error: `Level ${l.level}: chybí název`, level: l.level, focus: `[data-level="${l.level}"] .cur-level-title` };

    const sections = [];
    for (const s of l.sections) {
      const sTitle = s.title.trim();
      const at = `[data-sid="${s.id}"]`;
      if (!sTitle) return { error: `Level ${l.level}: podtéma bez názvu`, level: l.level, focus: `${at} .cur-sec-title` };

      const videos = [];
      for (const [i, v] of s.videos.entries()) {
        const vt = v.title.trim();
        const vu = v.url.trim();
        if (!vt && !vu) continue; // prázdný řádek se tiše vynechá
        const sel = `${at} .cur-video:nth-child(${i + 1})`;
        if (!vt) return { error: `„${sTitle}“: video bez názvu`, level: l.level, sid: s.id, focus: `${sel} .cur-v-title` };
        if (!isYoutubeUrl(vu)) {
          return { error: `„${sTitle}“: video „${vt}“ nemá platný odkaz na YouTube`, level: l.level, sid: s.id, focus: `${sel} .cur-v-url` };
        }
        videos.push({ id: v.id, title: vt, url: vu });
      }
      sections.push({ id: s.id, title: sTitle, videos });
    }
    levels.push({ level: l.level, title, sections });
  }
  return { levels };
}

$('save').addEventListener('click', () =>
  run(async () => {
    const result = collect();
    if (result.error) {
      state.open.add(result.level);
      if (result.sid) state.videosOpen.add(result.sid);
      state.focus = result.focus;
      throw new Error(result.error);
    }
    const res = await api('PUT', `/api/admin/curricula/${state.key}`, { version: state.version, levels: result.levels });
    state.version = res.version;
    state.work = result.levels;
    state.snapshot = JSON.stringify(state.work);
    Admin.toast('Kurikulum uloženo.');
  })
);

$('discard').addEventListener('click', () => {
  if (!isDirty() || state.busy) return;
  if (!confirm('Zahodit všechny neuložené změny?')) return;
  state.work = JSON.parse(state.snapshot);
  render();
});

/* ---------- ovládací prvky ---------- */

$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-key]');
  if (!btn || btn.dataset.key === state.key || state.busy) return;
  if (isDirty() && !confirm('Máte neuložené změny. Opravdu je zahodit a přepnout kurikulum?')) return;
  run(() => load(btn.dataset.key));
});

$('expand-all').addEventListener('click', () => {
  state.open = new Set(state.work.map((l) => l.level));
  render();
});
$('collapse-all').addEventListener('click', () => {
  state.open = new Set();
  render();
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

run(() => load('prijimacky'));