const $ = (id) => document.getElementById(id);
const { api, el, fmtDate, timeRange } = Admin;
const enc = encodeURIComponent;

const REQUIRED_IDS = [
  'list-view', 'detail-view', 'scope-tabs', 'f-lecturer', 'f-from', 'f-to', 'quick', 'lessons-table',
  'lessons-rows', 'lessons-empty', 'lessons-trunc', 'att-head', 'back', 'd-date', 'd-meta', 'student-tabs', 'student-panel',
];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) {
  Admin.toast(`Chybí prvky stránky: ${missing.join(', ')}`, true);
  throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);
}

const ATTENDANCE = { true: 'Přišel', false: 'Nepřišel' };

const state = {
  scope: 'past',
  lessons: [],
  truncated: false,
  detail: null,    // { lecturer, date, hour, students: [...] }
  active: null,    // číslo studenta s viditelným panelem
  levels: new Map(), // číslo studenta -> { progress, sections, tests, saved }
  att: new Map(),    // neuložená docházka: číslo studenta -> true/false
  busy: false,
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monthRange(offset) {
  const now = new Date();
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  };
}

function fullDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

/* ---------- seznam lekcí ---------- */

async function loadList() {
  const query = new URLSearchParams({ scope: state.scope });
  if ($('f-lecturer').value) query.set('lecturer', $('f-lecturer').value);
  if ($('f-from').value) query.set('from', $('f-from').value);
  if ($('f-to').value) query.set('to', $('f-to').value);
  const data = await api('GET', `/api/admin/lessons?${query}`);
  state.lessons = data.lessons;
  state.truncated = data.truncated;
}

function setRange(name) {
  const r = name === 'this' ? monthRange(0) : name === 'last' ? monthRange(-1) : { from: '', to: '' };
  $('f-from').value = r.from;
  $('f-to').value = r.to;
}

function studentsCell(lesson) {
  const pills = el('div', 'pills');
  for (const s of lesson.students) pills.append(el('span', 'pill', `${s.name} #${s.studentNumber}`));
  const cell = el('td');
  cell.append(pills);
  return cell;
}

function attendanceCell(lesson) {
  const pills = el('div', 'pills');
  for (const s of lesson.students) pills.append(el('span', 'pill', ATTENDANCE[s.attended] ?? '—'));
  const cell = el('td');
  cell.append(pills);
  return cell;
}

function renderList() {
  const past = state.scope === 'past';
  for (const b of $('scope-tabs').querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope));
  $('att-head').hidden = !past;
  $('lessons-table').hidden = state.lessons.length === 0;
  $('lessons-empty').hidden = state.lessons.length > 0;
  $('lessons-trunc').hidden = !state.truncated;

  $('lessons-rows').replaceChildren(
    ...state.lessons.map((l, i) => {
      const detail = el('button', 'btn btn-sm', 'Detail');
      detail.type = 'button';
      detail.dataset.index = i;
      detail.setAttribute('aria-label', `Detail lekce ${fmtDate(l.date)} ${timeRange(l.hour)}`);
      const hover = el('span', 'row-actions');
      hover.append(detail);
      const actions = el('td', 'actions');
      actions.append(hover);

      const tr = el('tr');
      tr.append(el('td', '', fmtDate(l.date)), el('td', '', timeRange(l.hour)), el('td', '', l.lecturer), studentsCell(l));
      if (past) tr.append(attendanceCell(l));
      tr.append(actions);
      return tr;
    })
  );
}

/* ---------- detail lekce ---------- */

const levelDirty = (entry) => diff(entry.sections, entry.saved.sections) + diff(entry.tests, entry.saved.tests) > 0;
const lessonDirty = () =>
  state.att.size > 0 || [...state.levels.values()].some((v) => diff(v.sections, v.saved.sections) + diff(v.tests, v.saved.tests) > 0);
const diff = (a, b) => [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;

async function loadLevel(number) {
  const data = await api('GET', `/api/admin/students/${enc(number)}/progress`);
  const sections = new Set(data.levels.flatMap((l) => l.sections.filter((s) => s.done).map((s) => s.id)));
  const tests = new Set(data.levels.filter((l) => l.testPassed).map((l) => l.level));
  state.levels.set(number, { progress: data, sections, tests, saved: { sections: new Set(sections), tests: new Set(tests) } });
}

async function openDetail(lecturer, date, hour) {
  const query = new URLSearchParams({ lecturer, date, hour: String(hour) });
  const lesson = await api('GET', `/api/admin/lessons/detail?${query}`);
  state.detail = lesson;
  state.levels.clear();
  state.att.clear();
  await Promise.all(lesson.students.map((s) => loadLevel(s.studentNumber)));
  state.active = lesson.students[0].studentNumber;
  window.scrollTo(0, 0);
}

function closeDetail() {
  if (lessonDirty() && !confirm('Máte neuložené změny levelu. Zahodit je?')) return;
  state.detail = null;
  state.levels.clear();
  state.att.clear();
  history.replaceState(null, '', location.pathname); // zahodí parametry z odkazu
  run(loadList);
}

// Jen aktuální level studenta: podúkoly a závěrečný test
function currentLevelOf(entry) {
  const { levels } = entry.progress;
  for (const l of levels) {
    const done = l.sections.filter((s) => entry.sections.has(s.id)).length;
    const passed = done === l.total && entry.tests.has(l.level);
    if (!passed) return { level: l, done, total: l.total };
  }
  return null; // kurz dokončen
}

function levelPanel(student) {
  const entry = state.levels.get(student.studentNumber);
  const box = el('div');
  box.append(el('h2', '', `${student.name} (#${student.studentNumber})`));
  if (entry.progress.label) box.append(el('p', 'hint', `Kurikulum: ${entry.progress.label}`));
  const attDirty = state.att.has(student.studentNumber);
  if (state.detail.past) {
    const current = attDirty ? state.att.get(student.studentNumber) : student.attended;
    const select = el('select');
    select.id = 'att-select';
    if (current === null || current === undefined) select.append(new Option('—', '', true, true));
    select.append(new Option('Přišel', 'true'), new Option('Nepřišel', 'false'));
    if (current !== null && current !== undefined) select.value = String(current);
    const field = el('label', 'field');
    field.style.maxWidth = '12rem';
    field.append(el('span', '', 'Docházka'), select);
    box.append(field);
  } else {
    box.append(el('p', 'hint', 'Docházku lze zapsat od dne konání lekce.'));
  }

  const cur = entry.progress.enabled === false ? null : currentLevelOf(entry);
  if (entry.progress.enabled === false) box.append(el('p', 'hint', 'Student má vlastní kurikulum, level systém není aktivní.'));
  else if (cur) addLevelEditor(box, entry, cur);
  else box.append(el('p', '', 'Kurz je dokončen, level není co upravovat.'));

  const dirty = attDirty || levelDirty(entry);
  const row = el('div', 'row');
  row.style.marginTop = '1rem';
  const save = el('button', 'btn btn-primary', 'Uložit změny');
  save.type = 'button';
  save.id = 'level-save';
  save.disabled = !dirty;
  row.append(save);
  if (dirty) row.append(el('span', 'hint', 'Neuložené změny'));
  box.append(row);
  return box;
}

function addLevelEditor(box, entry, cur) {
  const { level: l } = cur;
  box.append(el('h3', '', `Aktuální level ${l.level}: ${l.title} – ${cur.done}/${cur.total}`));
  const checks = el('div', 'checks');
  for (const s of l.sections) {
    const label = el('label', entry.sections.has(s.id) !== entry.saved.sections.has(s.id) ? 'changed' : '');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = entry.sections.has(s.id);
    input.dataset.kind = 'section';
    input.dataset.id = s.id;
    label.append(input, ` ${s.title}`);
    checks.append(label);
  }
  const test = el('label', entry.tests.has(l.level) !== entry.saved.tests.has(l.level) ? 'changed test-row' : 'test-row');
  const testInput = el('input');
  testInput.type = 'checkbox';
  testInput.checked = cur.done === cur.total && entry.tests.has(l.level);
  testInput.disabled = cur.done !== cur.total;
  testInput.dataset.kind = 'test';
  testInput.dataset.level = l.level;
  test.append(testInput, ' Závěrečný test splněn');
  checks.append(test);
  box.append(checks);
}

function renderDetail() {
  const d = state.detail;
  $('d-date').textContent = fullDate(d.date);
  $('d-meta').textContent = `${timeRange(d.hour)} · lektor ${d.lecturer} · ${d.students.length}/${d.capacity} studentů`;

  $('student-tabs').replaceChildren(
    ...d.students.map((s) => {
      const b = el('button', '', s.name);
      b.type = 'button';
      b.dataset.number = s.studentNumber;
      b.setAttribute('aria-pressed', String(s.studentNumber === state.active));
      return b;
    })
  );
  const student = d.students.find((s) => s.studentNumber === state.active);
  $('student-panel').replaceChildren(levelPanel(student));
}

function render() {
  $('list-view').hidden = Boolean(state.detail);
  $('detail-view').hidden = !state.detail;
  if (state.detail) renderDetail();
  else renderList();
}

/* ---------- události ---------- */

$('scope-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scope]');
  if (!b || b.dataset.scope === state.scope) return;
  state.scope = b.dataset.scope;
  setRange(state.scope === 'past' ? 'this' : 'all');
  run(loadList);
});

$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  setRange(b.dataset.range);
  run(loadList);
});

for (const id of ['f-lecturer', 'f-from', 'f-to']) $(id).addEventListener('change', () => run(loadList));

$('lessons-rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-index]');
  if (!b) return;
  const l = state.lessons[Number(b.dataset.index)];
  run(() => openDetail(l.lecturer, l.date, l.hour));
});

$('back').addEventListener('click', closeDetail);

$('student-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-number]');
  if (!b) return;
  state.active = b.dataset.number;
  render();
});

$('student-panel').addEventListener('change', (e) => {
  const box = e.target;
  if (box.id === 'att-select') {
    const student = state.detail.students.find((s) => s.studentNumber === state.active);
    const value = box.value === 'true';
    if (value === student.attended) state.att.delete(state.active);
    else state.att.set(state.active, value);
    render();
    return;
  }
  if (!box.matches('input[type="checkbox"][data-kind]')) return;
  const entry = state.levels.get(state.active);
  if (box.dataset.kind === 'section') {
    const level = entry.progress.levels.find((l) => l.sections.some((s) => s.id === box.dataset.id));
    if (box.checked) entry.sections.add(box.dataset.id);
    else {
      entry.sections.delete(box.dataset.id);
      entry.tests.delete(level.level); // test platí jen při splněných podúkolech
    }
  } else if (box.checked) entry.tests.add(Number(box.dataset.level));
  else entry.tests.delete(Number(box.dataset.level));
  render();
});

$('student-panel').addEventListener('click', (e) => {
  if (e.target.id !== 'level-save') return;
  const number = state.active;
  run(async () => {
    const entry = state.levels.get(number);
    const student = state.detail.students.find((s) => s.studentNumber === number);
    const { lecturer, date, hour } = state.detail;
    const errors = [];
    if (state.att.has(number)) {
      try {
        const attended = state.att.get(number);
        await api('PUT', `/api/admin/students/${enc(number)}/lessons/records`, { records: [{ lecturer, date, hour, attended }] });
        student.attended = attended;
        state.att.delete(number);
      } catch (err) {
        errors.push(`Docházka: ${err.message}`);
      }
    }
    if (levelDirty(entry)) {
      try {
        await api('PUT', `/api/admin/students/${enc(number)}/progress`, { sections: [...entry.sections], tests: [...entry.tests] });
        await loadLevel(number);
      } catch (err) {
        errors.push(`Level: ${err.message}`);
      }
    }
    if (errors.length) throw new Error(`Uloženo jen částečně. ${errors.join(' ')}`);
    Admin.toast('Uloženo.');
  });
});

window.addEventListener('beforeunload', (e) => {
  if (lessonDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------- start ---------- */

run(async () => {
  const cfg = await Admin.ready;
  $('f-lecturer').replaceChildren(new Option('Všichni lektoři', ''), ...cfg.lecturers.map((n) => new Option(n, n)));

  // odkaz z Rozvrhu: /admin/lessons.html?lecturer=…&date=…&hour=…
  const q = new URLSearchParams(location.search);
  if (q.get('lecturer') && q.get('date') && q.get('hour')) {
    try {
      await openDetail(q.get('lecturer'), q.get('date'), Number(q.get('hour')));
      return;
    } catch (err) {
      Admin.toast(err.message, true);
      history.replaceState(null, '', location.pathname);
    }
  }
  setRange('this');
  await loadList();
});