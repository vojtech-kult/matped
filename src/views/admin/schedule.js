const $ = (id) => document.getElementById(id);
const { api, el, fmtDate, timeRange } = Admin;

const DAY_NAMES = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const STATUS_TEXT = {
  on: 'učím (pravidelně)',
  once: 'učím jen tento týden',
  off: 'výjimka, tento týden neučím',
  empty: 'neučím',
};
const MODE_HINTS = {
  all: 'Klik přidá nebo odebere pravidelný termín pro všechny týdny v roce. Výjimky nastavíte tlačítkem ✎ v políčku.',
  week: 'Klik na prázdné políčko přidá termín jen pro tento týden. Klik na pravidelné políčko z něj pro tento týden udělá výjimku (dalším klikem ji zrušíte).',
};

// Kontrola, že HTML obsahuje všechny prvky, které skript používá
const REQUIRED_IDS = [
  'upcoming-who', 'upcoming-table', 'upcoming-rows', 'upcoming-empty', 'cal-who', 'year', 'week',
  'prev-week', 'next-week', 'this-week', 'week-range', 'mode-hint', 'grid', 'exceptions',
  'exceptions-title', 'exceptions-form', 'exceptions-input', 'exceptions-error', 'exceptions-close',
  'savebar', 'save', 'discard', 'dirty',
];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) {
  Admin.toast(`Chybí prvky stránky: ${missing.join(', ')}`, true);
  throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);
}

// Horní posuvná lišta kalendáře (top-scroll.js), zobrazí se jen když je potřeba
if (typeof enableTopScroll === 'function') enableTopScroll(document.querySelector('.grid-wrap'));

const state = {
  firstHour: 8,
  lastHour: 20,
  lecturer: '',
  year: 0,
  week: 0,
  mode: 'all',
  slots: new Map(),   // pracovní kopie rozvrhu, klíč "den-hodina-týden|all"
  saved: new Map(),   // stav uložený na serveru (pro porovnání se změnami)
  lessons: new Map(), // klíč "den-hodina" -> čísla přihlášených studentů v zobrazeném týdnu
  upcoming: null,     // nejbližší lekce vybraného lektora
  selected: null,     // políčko, jehož výjimky se upravují
  busy: false,
};

const key = (day, hour, week) => `${day}-${hour}-${week ?? 'all'}`;

// Všechny akce běží přes run(): zamezí souběžným klikům a vždy překreslí stránku
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

/* ---------- načítání ---------- */

async function loadLessons(lecturer, year, week) {
  const query = new URLSearchParams({ lecturer, year: String(year), week: String(week) });
  const rows = await api('GET', `/api/admin/availability/lessons?${query}`);
  state.lessons = new Map(rows.map((r) => [`${r.day}-${r.hour}`, r.students]));
}

async function loadUpcoming(lecturer) {
  const query = new URLSearchParams({ lecturer });
  state.upcoming = await api('GET', `/api/admin/availability/upcoming?${query}`);
}

const cloneSlot = (r) => ({ day: r.day, hour: r.hour, week: r.week, excludedWeeks: [...r.excludedWeeks] });
const sameWeeks = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

async function loadSlots(lecturer, year) {
  const query = new URLSearchParams({ lecturer, year: String(year) });
  const rows = await api('GET', `/api/admin/availability?${query}`);
  state.slots = new Map(rows.map((r) => [key(r.day, r.hour, r.week), cloneSlot(r)]));
  state.saved = new Map(rows.map((r) => [key(r.day, r.hour, r.week), cloneSlot(r)]));
  state.selected = null;
}

// Úpravy jen v paměti, na server jdou až po „Uložit změny“
const putSlot = (day, hour, week, excludedWeeks) =>
  state.slots.set(key(day, hour, week), { day, hour, week, excludedWeeks: [...excludedWeeks] });
const deleteSlot = (day, hour, week) => state.slots.delete(key(day, hour, week));

function slotDiffers(k) {
  const a = state.slots.get(k);
  const b = state.saved.get(k);
  return Boolean(a) !== Boolean(b) || Boolean(a && !sameWeeks(a.excludedWeeks, b.excludedWeeks));
}

function diffSlots() {
  const put = [];
  const del = [];
  for (const [k, rec] of state.slots) if (slotDiffers(k)) put.push(cloneSlot(rec));
  for (const [k, rec] of state.saved) {
    if (!state.slots.has(k)) del.push({ day: rec.day, hour: rec.hour, week: rec.week });
  }
  return { put, del };
}

function changeCount() {
  const { put, del } = diffSlots();
  return put.length + del.length;
}

const studentsAt = (day, hour) => state.lessons.get(`${day}-${hour}`) ?? [];

/* ---------- ISO týdny ---------- */

function isoWeeksInYear(year) {
  const d = new Date(Date.UTC(year, 11, 28));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function currentIsoWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

// Pondělí daného ISO týdne (4. leden je vždy v týdnu 1)
function weekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday;
}

const fmt = (date, withYear = false) =>
  date.toLocaleDateString('cs-CZ', {
    day: 'numeric', month: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC',
  });

function shifted(delta) {
  let { year, week } = state;
  week += delta;
  if (week < 1) {
    year -= 1;
    week = isoWeeksInYear(year);
  } else if (week > isoWeeksInYear(year)) {
    year += 1;
    week = 1;
  }
  return { year, week };
}

async function goTo(year, week) {
  year = Number.isInteger(year) ? Math.min(Math.max(year, 2000), 2100) : state.year;
  week = Number.isInteger(week) ? Math.min(Math.max(week, 1), isoWeeksInYear(year)) : state.week;
  if (year !== state.year) {
    if (changeCount() && !confirm('Máte neuložené změny rozvrhu. Přepnutím roku se zahodí. Pokračovat?')) return;
    await loadSlots(state.lecturer, year);
  }
  state.year = year;
  state.week = week;
  await loadLessons(state.lecturer, state.year, state.week);
}

/* ---------- stav políčka a kliknutí ---------- */

function cellState(day, hour) {
  const rec = state.slots.get(key(day, hour, null));
  const once = state.slots.get(key(day, hour, state.week));
  if (once) return 'once';
  if (rec && !rec.excludedWeeks.includes(state.week)) return 'on';
  if (rec) return 'off';
  return 'empty';
}

function confirmIfBooked(day, hour) {
  const students = studentsAt(day, hour);
  if (!students.length) return true;
  return confirm(
    `Na tento termín (zobrazený týden) jsou přihlášeni studenti: ${students.join(', ')}. ` +
    'Rezervace zůstanou v databázi, ale termín už nebude v rozvrhu. Pokračovat?'
  );
}

function toggleCell(day, hour) {
  const rec = state.slots.get(key(day, hour, null));
  const once = state.slots.get(key(day, hour, state.week));

  if (state.mode === 'all') {
    if (rec) {
      if (rec.excludedWeeks.length && !confirm('Smazáním pravidelného termínu se ztratí i jeho výjimky. Pokračovat?')) return;
      if (!confirmIfBooked(day, hour)) return;
      deleteSlot(day, hour, null);
    } else {
      putSlot(day, hour, null, []);
    }
    return;
  }

  // režim „jen zobrazený týden“
  if (once) {
    if (!confirmIfBooked(day, hour)) return;
    deleteSlot(day, hour, state.week);
  } else if (rec) {
    const excluded = new Set(rec.excludedWeeks);
    if (excluded.has(state.week)) {
      excluded.delete(state.week);
    } else {
      if (!confirmIfBooked(day, hour)) return;
      excluded.add(state.week);
    }
    putSlot(day, hour, null, [...excluded].sort((a, b) => a - b));
  } else {
    putSlot(day, hour, state.week, []);
  }
}

function openExceptions(day, hour) {
  const rec = state.slots.get(key(day, hour, null));
  if (!rec) return;
  state.selected = { day, hour };
  $('exceptions-input').value = rec.excludedWeeks.join(', ');
  $('exceptions-error').textContent = '';
}

// "25, 26, 30-32" -> [25, 26, 30, 31, 32]
function parseWeeks(text, max) {
  const weeks = new Set();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
    if (!m) throw new Error(`Neplatná hodnota „${part}“`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from > to || from < 1 || to > max) throw new Error(`Čísla týdnů musí být v rozsahu 1 až ${max}`);
    for (let w = from; w <= to; w++) weeks.add(w);
  }
  return [...weeks].sort((a, b) => a - b);
}

/* ---------- vykreslení ---------- */

function makeCell(day, hour) {
  const status = cellState(day, hour);
  const rec = state.slots.get(key(day, hour, null));
  const students = studentsAt(day, hour);
  const label = `${DAY_NAMES[day - 1]} ${timeRange(hour)}`;

  let text = `${label}: ${STATUS_TEXT[status]}`;
  if (students.length) text += `. Přihlášení studenti (${students.length}): ${students.join(', ')}`;

  const wrap = el('div', `cell ${status}`);
  if (students.length) {
    wrap.classList.add('booked');
    // student je přihlášen, ale termín už v tomto týdnu v rozvrhu není
    if (status === 'off' || status === 'empty') wrap.classList.add('orphan');
  }
  if (state.selected?.day === day && state.selected?.hour === hour) wrap.classList.add('selected');
  if (slotDiffers(key(day, hour, null)) || slotDiffers(key(day, hour, state.week))) wrap.classList.add('changed');

  const toggle = el('button', 'toggle');
  toggle.type = 'button';
  toggle.dataset.action = 'toggle';
  toggle.dataset.day = day;
  toggle.dataset.hour = hour;
  toggle.title = text;
  toggle.setAttribute('aria-label', text);
  toggle.setAttribute('aria-pressed', String(status === 'on' || status === 'once'));
  for (const number of students) toggle.append(el('span', 'student-no', number));
  wrap.append(toggle);

  if (rec) {
    const edit = el('button', 'edit', rec.excludedWeeks.length ? `✎ ${rec.excludedWeeks.length}` : '✎');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.dataset.day = day;
    edit.dataset.hour = hour;
    edit.title = `Výjimky (týdny bez výuky): ${rec.excludedWeeks.length ? rec.excludedWeeks.join(', ') : 'žádné'}`;
    edit.setAttribute('aria-label', `Upravit výjimky: ${label}`);
    wrap.append(edit);
  }
  return wrap;
}

function renderUpcoming() {
  const data = state.upcoming;
  const lessons = data?.lessons ?? [];
  $('upcoming-who').textContent = state.lecturer ? `· ${state.lecturer}` : '';
  $('upcoming-table').hidden = lessons.length === 0;
  $('upcoming-empty').hidden = !data || lessons.length > 0;

  $('upcoming-rows').replaceChildren(
    ...lessons.map((lesson) => {
      const tr = el('tr');

      const date = el('td', '', fmtDate(lesson.date));
      if (lesson.date === data.today) date.append(el('span', 'badge', 'Dnes'));

      const pills = el('div', 'pills');
      for (const s of lesson.students) {
        const pill = el('span', 'pill', s.name);
        pill.append(' ', el('small', '', `#${s.studentNumber}`));
        pills.append(pill);
      }

      const detail = el('a', 'btn btn-sm', 'Detail');
      const query = new URLSearchParams({ lecturer: state.lecturer, date: lesson.date, hour: String(lesson.hour) });
      detail.href = `/admin/lessons.html?${query}`;
      detail.setAttribute('aria-label', `Detail lekce ${fmtDate(lesson.date)} ${timeRange(lesson.hour)}`);
      const hover = el('span', 'row-actions');
      hover.append(detail);
      const actions = el('td', 'actions');
      actions.append(hover);

      const studentsCell = el('td');
      studentsCell.append(pills);
      tr.append(date, el('td', '', timeRange(lesson.hour)), studentsCell, actions);
      return tr;
    })
  );
}

function renderCalendar() {
  $('cal-who').textContent = state.lecturer ? `· ${state.lecturer}` : '';
  $('year').value = state.year;
  $('week').value = state.week;
  $('week').max = isoWeeksInYear(state.year);
  $('mode-hint').textContent = MODE_HINTS[state.mode];
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  }

  const monday = weekMonday(state.year, state.week);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  $('week-range').textContent = `${fmt(monday)} – ${fmt(sunday, true)}`;

  const items = [el('div')];
  for (let hour = state.firstHour; hour <= state.lastHour; hour++) items.push(el('div', 'head', `${hour}:00`));
  for (let day = 1; day <= 7; day++) {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + day - 1);
    const label = el('div', 'day', DAY_NAMES[day - 1]);
    label.append(el('small', '', fmt(date)));
    items.push(label);
    for (let hour = state.firstHour; hour <= state.lastHour; hour++) items.push(makeCell(day, hour));
  }
  $('grid').replaceChildren(...items);
}

function render() {
  if (!state.year) return;
  renderUpcoming();
  renderCalendar();

  // okno s výjimkami je otevřené jen pro existující pravidelné políčko
  if (state.selected && !state.slots.has(key(state.selected.day, state.selected.hour, null))) state.selected = null;
  const dialog = $('exceptions');
  if (state.selected) {
    const { day, hour } = state.selected;
    $('exceptions-title').textContent = `${DAY_NAMES[day - 1]} ${timeRange(hour)}`;
    if (!dialog.open) dialog.showModal();
  } else if (dialog.open) {
    dialog.close();
  }

  const count = changeCount();
  $('savebar').hidden = count === 0;
  $('dirty').textContent = count ? `Neuložené změny: ${count}` : '';
}

/* ---------- události ---------- */

$('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const day = Number(btn.dataset.day);
  const hour = Number(btn.dataset.hour);
  run(async () => {
    if (btn.dataset.action === 'edit') openExceptions(day, hour);
    else toggleCell(day, hour);
  });
});

$('exceptions-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.selected) return;
  const { day, hour } = state.selected;
  try {
    const weeks = parseWeeks($('exceptions-input').value, isoWeeksInYear(state.year));
    run(async () => {
      putSlot(day, hour, null, weeks);
      state.selected = null;
      Admin.toast(weeks.length ? `Výjimky nastaveny: ${weeks.join(', ')} (zatím neuloženo)` : 'Výjimky odstraněny (zatím neuloženo).');
    });
  } catch (err) {
    $('exceptions-error').textContent = err.message;
  }
});

$('exceptions-close').addEventListener('click', () => $('exceptions').close());
// zavření okna (tlačítko, Esc) zruší výběr políčka
$('exceptions').addEventListener('close', () => {
  state.selected = null;
  render();
});
// klik na pozadí okna
$('exceptions').addEventListener('click', (e) => {
  if (e.target === $('exceptions')) $('exceptions').close();
});

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    render();
  });
}

$('save').addEventListener('click', () =>
  run(async () => {
    const { put, del } = diffSlots();
    if (!put.length && !del.length) return;
    await api('PUT', '/api/admin/availability/batch', {
      lecturer: state.lecturer, year: state.year, put, delete: del,
    });
    await loadSlots(state.lecturer, state.year);
    Admin.toast('Rozvrh uložen.');
  })
);

$('discard').addEventListener('click', () =>
  run(async () => {
    if (!confirm('Zahodit všechny neuložené změny rozvrhu?')) return;
    await loadSlots(state.lecturer, state.year);
    Admin.toast('Změny zahozeny.');
  })
);

window.addEventListener('beforeunload', (e) => {
  if (changeCount()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

$('year').addEventListener('change', () => run(() => goTo(Number($('year').value), state.week)));
$('week').addEventListener('change', () => run(() => goTo(state.year, Number($('week').value))));
$('prev-week').addEventListener('click', () => run(() => { const s = shifted(-1); return goTo(s.year, s.week); }));
$('next-week').addEventListener('click', () => run(() => { const s = shifted(1); return goTo(s.year, s.week); }));
$('this-week').addEventListener('click', () => run(() => { const n = currentIsoWeek(); return goTo(n.year, n.week); }));

// Lektor z horní lišty: neuložené změny je potřeba potvrdit, pak se načte jeho rozvrh
Admin.beforeLecturerChange = () =>
  !changeCount() || confirm('Máte neuložené změny rozvrhu. Přepnutím lektora se zahodí. Pokračovat?');

Admin.onLecturerChange((lecturer) =>
  run(async () => {
    await Promise.all([loadSlots(lecturer, state.year), loadLessons(lecturer, state.year, state.week), loadUpcoming(lecturer)]);
    state.lecturer = lecturer;
  })
);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.year) {
    run(() => Promise.all([loadLessons(state.lecturer, state.year, state.week), loadUpcoming(state.lecturer)]));
  }
});

/* ---------- start ---------- */

run(async () => {
  const cfg = await Admin.ready;
  state.firstHour = cfg.firstHour;
  state.lastHour = cfg.lastHour;
  const lecturer = Admin.lecturer;
  const now = currentIsoWeek();
  await Promise.all([loadSlots(lecturer, now.year), loadLessons(lecturer, now.year, now.week), loadUpcoming(lecturer)]);
  state.lecturer = lecturer;
  state.year = now.year;
  state.week = now.week;
});
