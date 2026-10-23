const $ = (id) => document.getElementById(id);

// Kontrola, že HTML obsahuje všechny prvky, které skript používá
const REQUIRED_IDS = [
  'message', 'lecturer', 'year', 'week', 'prev-week', 'next-week', 'this-week', 'week-range',
  'mode-hint', 'grid', 'exceptions', 'exceptions-title', 'exceptions-form', 'exceptions-input',
  'exceptions-close', 'save', 'discard', 'dirty',
  'upcoming-hint', 'upcoming-list', 'past-hint', 'past-table', 'past-rows',
];
const missingIds = REQUIRED_IDS.filter((id) => !document.getElementById(id));
if (missingIds.length) {
  const warning = document.createElement('p');
  warning.style.cssText = 'color:crimson;font-weight:700';
  warning.textContent = `V HTML chybí prvky s těmito id: ${missingIds.join(', ')}. Stránka nemůže fungovat.`;
  document.body.prepend(warning);
  throw new Error(`Chybí prvky: ${missingIds.join(', ')}`);
}

const message = $('message');

// Horní posuvná lišta kalendáře (top-scroll.js), zobrazí se jen když je potřeba
if (typeof enableTopScroll === 'function') enableTopScroll(document.querySelector('.grid-wrap'));

const DAY_NAMES = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const STATUS_TEXT = {
  on: 'učím (pravidelně)',
  once: 'učím jen tento týden',
  off: 'výjimka, tento týden neučím',
  empty: 'neučím',
};
const MODE_HINTS = {
  all: 'Klik přidá nebo odebere pravidelný termín pro všechny týdny v roce. Výjimky nastavíte tlačítkem ✎ v políčku. Změny se uloží až tlačítkem „Uložit změny“.',
  week: 'Klik na prázdné políčko přidá termín jen pro tento týden. Klik na pravidelné políčko z něj pro tento týden udělá výjimku (dalším klikem ji zrušíte). Změny se uloží až tlačítkem „Uložit změny“.',
};

const state = {
  firstHour: 8,
  lastHour: 20,
  lecturer: '',
  year: 0,
  week: 0,
  mode: 'all',
  slots: new Map(), // pracovní kopie rozvrhu, klíč "den-hodina-týden|all"
  saved: new Map(), // stav rozvrhu uložený na serveru (pro porovnání se změnami)
  lessons: new Map(), // klíč "den-hodina" -> čísla přihlášených studentů v zobrazeném týdnu
  upcoming: null, // nejbližší lekce vybraného lektora
  past: null, // odučené lekce vybraného lektora
  selected: null, // políčko, jehož výjimky se upravují
  busy: false,
};

const key = (day, hour, week) => `${day}-${hour}-${week ?? 'all'}`;

/* ---------- komunikace se serverem ---------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/admin-login.html';
    throw new Error('Nepřihlášen');
  }
  if (!res.ok) throw new Error(data.error ?? 'Chyba');
  return data;
}

function show(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? 'crimson' : 'green';
}

// Všechny akce běží přes run(): zamezí souběžným klikům a vždy překreslí stránku
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  show('');
  try {
    await fn();
  } catch (err) {
    show(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

/* ---------- načítání dat ---------- */

const cloneSlot = (r) => ({ day: r.day, hour: r.hour, week: r.week, excludedWeeks: [...r.excludedWeeks] });
const sameWeeks = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

async function loadSlots(lecturer, year) {
  const query = new URLSearchParams({ lecturer, year: String(year) });
  const rows = await api('GET', `/api/admin/availability?${query}`);
  state.slots = new Map(rows.map((r) => [key(r.day, r.hour, r.week), cloneSlot(r)]));
  state.saved = new Map(rows.map((r) => [key(r.day, r.hour, r.week), cloneSlot(r)]));
  state.selected = null;
}

async function loadLessons(lecturer, year, week) {
  const query = new URLSearchParams({ lecturer, year: String(year), week: String(week) });
  const rows = await api('GET', `/api/admin/availability/lessons?${query}`);
  state.lessons = new Map(rows.map((r) => [`${r.day}-${r.hour}`, r.students]));
}

async function loadUpcoming(lecturer) {
  const query = new URLSearchParams({ lecturer });
  state.upcoming = await api('GET', `/api/admin/availability/upcoming?${query}`);
}

async function loadPast(lecturer) {
  const query = new URLSearchParams({ lecturer });
  state.past = await api('GET', `/api/admin/availability/past?${query}`);
}

// Obnoví všechny přehledy rezervací vybraného lektora
async function loadOverviews(lecturer, year, week) {
  await Promise.all([loadLessons(lecturer, year, week), loadUpcoming(lecturer), loadPast(lecturer)]);
}

const studentsAt = (day, hour) => state.lessons.get(`${day}-${hour}`) ?? [];

/* ---------- úpravy v paměti (na server jdou až po „Uložit změny“) ---------- */

function putSlot(day, hour, week, excludedWeeks) {
  state.slots.set(key(day, hour, week), { day, hour, week, excludedWeeks: [...excludedWeeks] });
}

function deleteSlot(day, hour, week) {
  state.slots.delete(key(day, hour, week));
}

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

/* ---------- vykreslení: přehledy lekcí ---------- */

function fmtLessonDate(s, weekday = 'long') {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', {
    weekday, day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

const studentLink = (s) => {
  const link = document.createElement('a');
  link.href = `/admin/students.html?number=${encodeURIComponent(s.studentNumber)}`;
  link.textContent = `${s.studentNumber} – ${s.name || 'bez jména'}`;
  return link;
};

function renderUpcoming() {
  const list = $('upcoming-list');
  const data = state.upcoming;
  if (!data) {
    list.replaceChildren();
    return;
  }

  $('upcoming-hint').textContent = data.lessons.length
    ? `Lektor ${state.lecturer}: nejbližší lekce s přihlášenými studenty (nejvýše 15).`
    : `Lektor ${state.lecturer} zatím nemá žádnou naplánovanou lekci s přihlášeným studentem.`;

  list.replaceChildren(
    ...data.lessons.map((lesson) => {
      const li = document.createElement('li');
      li.className = 'upcoming-item';

      const head = document.createElement('div');
      head.className = 'upcoming-head';

      const when = document.createElement('span');
      when.className = 'upcoming-when';
      when.textContent = `${fmtLessonDate(lesson.date)}, ${lesson.hour}:00–${lesson.hour}:50`;
      head.append(when);

      if (lesson.date === data.today) {
        const badge = document.createElement('span');
        badge.className = 'upcoming-today';
        badge.textContent = 'Dnes';
        head.append(badge);
      }

      const count = document.createElement('span');
      count.className = 'upcoming-count';
      count.textContent = `Obsazeno ${lesson.students.length}/${data.capacity}`;
      head.append(count);

      const students = document.createElement('ul');
      students.className = 'upcoming-students';
      for (const s of lesson.students) {
        const item = document.createElement('li');
        item.append(studentLink(s), ` · ${s.paid ? 'zaplaceno' : 'nezaplaceno'}`);
        students.append(item);
      }

      li.append(head, students);
      return li;
    })
  );
}

function textCell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderPast() {
  const data = state.past;
  const body = $('past-rows');
  if (!data) {
    body.replaceChildren();
    $('past-table').hidden = true;
    return;
  }

  const total = data.lessons.length;
  $('past-hint').textContent = total
    ? `Lektor ${state.lecturer}: odučené lekce, nejnovější nahoře` +
      (total >= data.limit ? ` (zobrazeno posledních ${data.limit}).` : '.') +
      ' Docházku a platby upravíte v Přehledu studentů.'
    : `Lektor ${state.lecturer} zatím nemá žádnou odučenou lekci s přihlášeným studentem.`;
  $('past-table').hidden = total === 0;

  const rows = [];
  for (const lesson of data.lessons) {
    for (const s of lesson.students) {
      const tr = document.createElement('tr');
      const studentCell = document.createElement('td');
      studentCell.append(studentLink(s));

      tr.append(
        textCell(fmtLessonDate(lesson.date, 'short')),
        textCell(`${lesson.hour}:00–${lesson.hour}:50`),
        studentCell,
        textCell(s.attended === true ? 'Přišel' : s.attended === false ? 'Nepřišel' : '—'),
        textCell(s.paid ? 'Zaplaceno' : 'Nezaplaceno', s.paid ? 'paid-yes' : 'paid-no')
      );
      rows.push(tr);
    }
  }
  body.replaceChildren(...rows);
}

/* ---------- vykreslení: kalendář ---------- */

function makeCell(day, hour) {
  const status = cellState(day, hour);
  const rec = state.slots.get(key(day, hour, null));
  const students = studentsAt(day, hour);
  const label = `${DAY_NAMES[day - 1]} ${hour}:00–${hour}:50`;

  let text = `${label}: ${STATUS_TEXT[status]}`;
  if (students.length) text += `. Přihlášení studenti (${students.length}): ${students.join(', ')}`;

  const wrap = document.createElement('div');
  wrap.className = `cell ${status}`;
  if (students.length) {
    wrap.classList.add('booked');
    // student je přihlášen, ale termín už v tomto týdnu v rozvrhu není
    if (status === 'off' || status === 'empty') wrap.classList.add('orphan');
  }
  if (state.selected?.day === day && state.selected?.hour === hour) wrap.classList.add('selected');
  if (slotDiffers(key(day, hour, null)) || slotDiffers(key(day, hour, state.week))) wrap.classList.add('changed');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.dataset.action = 'toggle';
  toggle.dataset.day = day;
  toggle.dataset.hour = hour;
  toggle.title = text;
  toggle.setAttribute('aria-label', text);
  toggle.setAttribute('aria-pressed', String(status === 'on' || status === 'once'));
  for (const number of students) {
    const line = document.createElement('span');
    line.className = 'student-no';
    line.textContent = number;
    toggle.append(line);
  }
  wrap.append(toggle);

  if (rec) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit';
    edit.dataset.action = 'edit';
    edit.dataset.day = day;
    edit.dataset.hour = hour;
    const count = rec.excludedWeeks.length;
    edit.textContent = count ? `✎ ${count}` : '✎';
    edit.title = `Výjimky (týdny bez výuky): ${count ? rec.excludedWeeks.join(', ') : 'žádné'}`;
    edit.setAttribute('aria-label', `Upravit výjimky: ${label}`);
    wrap.append(edit);
  }
  return wrap;
}

function render() {
  if (!state.year) return;

  $('lecturer').value = state.lecturer;
  $('year').value = state.year;
  $('week').value = state.week;
  $('week').max = isoWeeksInYear(state.year);
  $('mode-hint').textContent = MODE_HINTS[state.mode];

  const monday = weekMonday(state.year, state.week);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  $('week-range').textContent = `${fmt(monday)} – ${fmt(sunday, true)}`;

  const items = [document.createElement('div')];
  for (let hour = state.firstHour; hour <= state.lastHour; hour++) {
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = `${hour}:00`;
    items.push(head);
  }
  for (let day = 1; day <= 7; day++) {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + day - 1);

    const label = document.createElement('div');
    label.className = 'day';
    label.textContent = DAY_NAMES[day - 1];
    const small = document.createElement('small');
    small.textContent = fmt(date);
    label.append(small);
    items.push(label);

    for (let hour = state.firstHour; hour <= state.lastHour; hour++) {
      items.push(makeCell(day, hour));
    }
  }
  $('grid').replaceChildren(...items);

  // panel s výjimkami zobrazíme jen pro existující pravidelné políčko
  if (state.selected && !state.slots.has(key(state.selected.day, state.selected.hour, null))) {
    state.selected = null;
  }
  $('exceptions').hidden = !state.selected;
  if (state.selected) {
    const { day, hour } = state.selected;
    $('exceptions-title').textContent = `${DAY_NAMES[day - 1]} ${hour}:00–${hour}:50`;
  }

  const count = changeCount();
  $('save').disabled = count === 0;
  $('discard').disabled = count === 0;
  $('dirty').textContent = count ? `Neuložené změny: ${count}` : '';

  renderUpcoming();
  renderPast();
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
  run(async () => {
    const weeks = parseWeeks($('exceptions-input').value, isoWeeksInYear(state.year));
    putSlot(day, hour, null, weeks);
    $('exceptions-input').value = weeks.join(', ');
    show(
      weeks.length
        ? `Výjimky nastaveny: ${weeks.join(', ')} (zatím neuloženo)`
        : 'Výjimky odstraněny (zatím neuloženo).'
    );
  });
});

$('exceptions-close').addEventListener('click', () => {
  state.selected = null;
  render();
});

$('lecturer').addEventListener('change', () =>
  run(async () => {
    if (changeCount() && !confirm('Máte neuložené změny rozvrhu. Přepnutím lektora se zahodí. Pokračovat?')) {
      $('lecturer').value = state.lecturer;
      return;
    }
    const lecturer = $('lecturer').value;
    await loadSlots(lecturer, state.year);
    await loadOverviews(lecturer, state.year, state.week);
    state.lecturer = lecturer;
  })
);

$('save').addEventListener('click', () =>
  run(async () => {
    const { put, del } = diffSlots();
    if (!put.length && !del.length) return;
    await api('PUT', '/api/admin/availability/batch', {
      lecturer: state.lecturer, year: state.year, put, delete: del,
    });
    await loadSlots(state.lecturer, state.year);
    show('Rozvrh uložen.');
  })
);

$('discard').addEventListener('click', () =>
  run(async () => {
    if (!confirm('Zahodit všechny neuložené změny rozvrhu?')) return;
    await loadSlots(state.lecturer, state.year);
    show('Změny zahozeny.');
  })
);

window.addEventListener('beforeunload', (e) => {
  if (changeCount()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Po návratu na záložku obnovíme rezervace studentů (mezitím se mohl někdo přihlásit)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.year) {
    run(() => loadOverviews(state.lecturer, state.year, state.week));
  }
});

$('year').addEventListener('change', () => run(() => goTo(Number($('year').value), state.week)));
$('week').addEventListener('change', () => run(() => goTo(state.year, Number($('week').value))));
$('prev-week').addEventListener('click', () => run(() => { const s = shifted(-1); return goTo(s.year, s.week); }));
$('next-week').addEventListener('click', () => run(() => { const s = shifted(1); return goTo(s.year, s.week); }));
$('this-week').addEventListener('click', () => run(() => { const n = currentIsoWeek(); return goTo(n.year, n.week); }));

document.querySelectorAll('input[name="mode"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    state.mode = radio.value;
    render();
  })
);

/* ---------- start ---------- */

run(async () => {
  const cfg = await api('GET', '/api/admin/availability/config');
  state.firstHour = cfg.firstHour;
  state.lastHour = cfg.lastHour;
  $('lecturer').replaceChildren(...cfg.lecturers.map((name) => new Option(name, name)));

  const lecturer = cfg.lecturers[0];
  const now = currentIsoWeek();
  await loadSlots(lecturer, now.year);
  await loadOverviews(lecturer, now.year, now.week);
  state.lecturer = lecturer;
  state.year = now.year;
  state.week = now.week;
});