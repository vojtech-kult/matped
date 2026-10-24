const $ = (id) => document.getElementById(id);
const { api, el, fmtDate, timeRange } = Admin;
const enc = encodeURIComponent;

const REQUIRED_IDS = [
  'create-open', 'students-table', 'students-rows', 'students-empty', 'detail', 'detail-title', 'detail-close',
  'detail-tabs', 'lecturer-filter', 'lecturer-filter-wrap', 'past-table', 'past-rows', 'past-empty',
  'future-table', 'future-rows', 'future-empty', 'progress-summary', 'levels',
  'create-dialog', 'create-form', 'edit-dialog', 'edit-form', 'delete-student', 'savebar', 'save', 'discard', 'dirty',
];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) {
  Admin.toast(`Chybí prvky stránky: ${missing.join(', ')}`, true);
  throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);
}

const state = {
  students: [],
  number: null,          // student s otevřeným detailem
  editing: null,         // student v okně „Upravit“
  tab: 'past',
  lecturer: '',          // filtr lektora ('' = všichni)
  lessons: [],
  edits: new Map(),      // neuložená docházka: klíč lekce -> true/false
  progress: null,
  sections: new Set(),   // pracovní kopie postupu
  tests: new Set(),
  saved: { sections: new Set(), tests: new Set() },
  open: new Set(),
  busy: false,
};

const lessonKey = (l) => `${l.lecturer}|${l.date}|${l.hour}`;
const diffCount = (a, b) => [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
const progressChanges = () =>
  state.progress ? diffCount(state.sections, state.saved.sections) + diffCount(state.tests, state.saved.tests) : 0;
const changeCount = () => state.edits.size + progressChanges();

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

/* ---------- dialogy ---------- */

function wireDialog(dialog) {
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if ((e.target === dialog && downOnBackdrop) || e.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.querySelectorAll('form').forEach((f) => f.reset());
    dialog.querySelector('.flash').textContent = '';
  });
}
wireDialog($('create-dialog'));
wireDialog($('edit-dialog'));

// odeslání formuláře v okně: chyba zůstane v okně, úspěch ho zavře
function dialogSubmit(form, dialog, action) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const flash = dialog.querySelector('.flash');
    flash.textContent = '';
    if (state.busy) return;
    state.busy = true;
    try {
      await action(new FormData(form));
      dialog.close();
    } catch (err) {
      flash.textContent = err.message;
    } finally {
      state.busy = false;
      render();
    }
  });
}

/* ---------- načítání ---------- */

async function loadStudents() {
  const data = await api('GET', '/api/admin/students');
  state.students = Array.isArray(data) ? data : data.students;
}

async function loadLessons(number) {
  const data = await api('GET', `/api/admin/students/${enc(number)}/lessons`);
  if (number !== state.number) return;
  state.lessons = data.lessons;
}

async function loadProgress(number, resetOpen = false) {
  const data = await api('GET', `/api/admin/students/${enc(number)}/progress`);
  if (number !== state.number) return;
  state.progress = data;
  state.sections = new Set(data.levels.flatMap((l) => l.sections.filter((s) => s.done).map((s) => s.id)));
  state.tests = new Set(data.levels.filter((l) => l.testPassed).map((l) => l.level));
  state.saved = { sections: new Set(state.sections), tests: new Set(state.tests) };
  if (resetOpen) state.open = new Set(data.currentLevel ? [data.currentLevel] : []);
}

async function openDetail(number) {
  if (number === state.number) return;
  if (changeCount() && !confirm('Máte neuložené změny u jiného studenta. Zahodit je?')) return;
  state.number = number;
  state.edits.clear();
  state.lessons = [];
  state.progress = null;
  state.tab = 'past';
  await Promise.all([loadLessons(number), loadProgress(number, true)]);
  $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- vykreslení ---------- */

function td(content, className) {
  const cell = el('td', className);
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content ?? '';
  return cell;
}

function actions(...buttons) {
  const box = el('span', 'row-actions');
  box.append(...buttons);
  return td(box, 'actions');
}

function button(text, action, number) {
  const b = el('button', 'btn btn-sm', text);
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.number = number;
  return b;
}

function renderStudents() {
  $('students-table').hidden = state.students.length === 0;
  $('students-empty').hidden = state.students.length > 0;
  $('students-rows').replaceChildren(
    ...state.students.map((s) => {
      const level = el('span');
      if (s.courseCompleted) {
        level.textContent = 'Kurz dokončen ✓';
      } else {
        const bar = el('progress');
        bar.max = 100;
        bar.value = s.levelPercent;
        level.append(`Level ${s.level} · ${s.levelPercent} % `, bar);
      }
      const tr = el('tr');
      if (s.studentNumber === state.number) tr.className = 'selected';
      tr.append(
        td(s.studentNumber), td(s.name), td(level), td(String(s.credits ?? 0)),
        actions(button('Upravit', 'edit', s.studentNumber), button('Detail', 'detail', s.studentNumber))
      );
      return tr;
    })
  );
}

function lessonRows(list, withAttendance) {
  return list.map((l) => {
    const tr = el('tr');
    const key = lessonKey(l);
    const cells = [td(fmtDate(l.date)), td(timeRange(l.hour)), td(l.lecturer)];
    if (withAttendance) {
      const current = state.edits.has(key) ? state.edits.get(key) : l.attended;
      const select = el('select');
      select.dataset.key = key;
      if (current === null || current === undefined) select.append(new Option('—', '', true, true));
      select.append(new Option('Přišel', 'true'), new Option('Nepřišel', 'false'));
      if (current !== null && current !== undefined) select.value = String(current);
      cells.push(td(select));
      if (state.edits.has(key)) tr.className = 'changed';
    }
    tr.append(...cells);
    return tr;
  });
}

function renderLessons() {
  const byLecturer = (l) => !state.lecturer || l.lecturer === state.lecturer;
  const when = (l) => `${l.date} ${String(l.hour).padStart(2, '0')}`;
  const past = state.lessons.filter((l) => l.past && byLecturer(l)).sort((a, b) => when(b).localeCompare(when(a)));
  const future = state.lessons.filter((l) => !l.past && byLecturer(l)).sort((a, b) => when(a).localeCompare(when(b)));
  $('past-table').hidden = past.length === 0;
  $('past-empty').hidden = past.length > 0;
  $('past-rows').replaceChildren(...lessonRows(past, true));
  $('future-table').hidden = future.length === 0;
  $('future-empty').hidden = future.length > 0;
  $('future-rows').replaceChildren(...lessonRows(future, false));
}

// Stav levelů z pracovní kopie (stejná pravidla jako na serveru)
function progressView() {
  const { levels, xpPerSection, xpPerTest } = state.progress;
  let xp = 0;
  const out = levels.map((l) => {
    const sections = l.sections.map((s) => ({ ...s, done: state.sections.has(s.id) }));
    const doneCount = sections.filter((s) => s.done).length;
    const testPassed = doneCount === l.total && state.tests.has(l.level);
    xp += doneCount * xpPerSection + (testPassed ? xpPerTest : 0);
    return { ...l, sections, doneCount, percent: Math.round((doneCount / l.total) * 100), testPassed, completed: testPassed };
  });
  const current = out.find((l) => !l.completed);
  for (const l of out) l.status = l.completed ? 'completed' : l === current ? 'current' : 'upcoming';
  return { levels: out, current, xp };
}

function checkbox(kind, level, id, checked, disabled = false) {
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.disabled = disabled;
  box.dataset.kind = kind;
  box.dataset.level = level;
  if (id) box.dataset.id = id;
  return box;
}

function levelElement(l) {
  const details = el('details', `level ${l.status}`);
  details.open = state.open.has(l.level);
  details.addEventListener('toggle', () => {
    if (details.open) state.open.add(l.level);
    else state.open.delete(l.level);
  });

  const bar = el('progress');
  bar.max = 100;
  bar.value = l.percent;
  const status = l.completed ? ' ✓' : l.status === 'current' ? ' (aktuální)' : '';
  const summary = el('summary');
  summary.append(`Level ${l.level}: ${l.title} – ${l.doneCount}/${l.total} (${l.percent} %)${status} `, bar);
  details.append(summary);

  const checks = el('div', 'checks');
  for (const s of l.sections) {
    const label = el('label', s.done !== state.saved.sections.has(s.id) ? 'changed' : '');
    label.append(checkbox('section', l.level, s.id, s.done), ` ${s.title}`);
    checks.append(label);
  }
  const test = el('label', l.testPassed !== state.saved.tests.has(l.level) ? 'changed test-row' : 'test-row');
  test.append(checkbox('test', l.level, null, l.testPassed, l.doneCount !== l.total), ' Závěrečný test splněn');
  checks.append(test);
  details.append(checks);
  return details;
}

function renderProgress() {
  if (!state.progress) {
    $('levels').replaceChildren();
    return;
  }
  const v = progressView();
  const { maxXp } = state.progress;
  $('progress-summary').textContent = v.current
    ? `Aktuální level: ${v.current.level} z ${v.levels.length}. XP: ${v.xp} / ${maxXp}`
    : `Kurz je dokončen. XP: ${v.xp} / ${maxXp}`;
  $('levels').replaceChildren(...v.levels.map(levelElement));
}

function render() {
  renderStudents();
  const student = state.students.find((s) => s.studentNumber === state.number);
  $('detail').hidden = !student;
  if (student) {
    $('detail-title').textContent = `Detail: ${student.name} (#${student.studentNumber})`;
    for (const b of $('detail-tabs').querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab));
    for (const p of $('detail').querySelectorAll(':scope > [data-panel]')) p.hidden = p.dataset.panel !== state.tab;
    $('lecturer-filter-wrap').hidden = state.tab === 'progress';
    renderLessons();
    renderProgress();
  }
  const count = changeCount();
  $('savebar').hidden = count === 0;
  const parts = [];
  if (state.edits.size) parts.push(`docházka: ${state.edits.size}`);
  if (progressChanges()) parts.push(`postup: ${progressChanges()}`);
  $('dirty').textContent = count ? `Neuložené změny (${parts.join(', ')})` : '';
}

/* ---------- události ---------- */

$('students-rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  const number = b.dataset.number;
  if (b.dataset.action === 'detail') {
    run(() => openDetail(number));
    return;
  }
  const student = state.students.find((s) => s.studentNumber === number);
  state.editing = number;
  const form = $('edit-form');
  form.elements.name.value = student.name;
  form.elements.creditsDelta.value = 0;
  $('credits-now').textContent = `Aktuálně: ${student.credits ?? 0}`;
  updateCreditsPreview();
  $('edit-heading').textContent = `Upravit: ${student.name} (#${number})`;
  $('edit-dialog').showModal();
});

function updateCreditsPreview() {
  const student = state.students.find((s) => s.studentNumber === state.editing);
  const delta = Number($('edit-form').elements.creditsDelta.value) || 0;
  const after = (student?.credits ?? 0) + delta;
  $('credits-after').textContent = delta ? `po uložení: ${after}${after < 0 ? ' (nelze, nejméně 0)' : ''}` : '';
}
$('edit-form').elements.creditsDelta.addEventListener('input', updateCreditsPreview);

$('create-open').addEventListener('click', () => $('create-dialog').showModal());

dialogSubmit($('create-form'), $('create-dialog'), async (fd) => {
  await api('POST', '/api/admin/students', {
    studentNumber: fd.get('studentNumber').trim(),
    name: fd.get('name').trim(),
    password: fd.get('password'),
    credits: Number(fd.get('credits')),
  });
  await loadStudents();
  Admin.toast('Student vytvořen.');
});

dialogSubmit($('edit-form'), $('edit-dialog'), async (fd) => {
  const number = state.editing;
  await api('PATCH', `/api/admin/students/${enc(number)}`, { name: fd.get('name').trim(), creditsDelta: Number(fd.get('creditsDelta')) || 0 });
  const password = fd.get('password');
  if (password) await api('PATCH', `/api/admin/students/${enc(number)}/password`, { password });
  await loadStudents();
  Admin.toast('Změny uloženy.');
});

$('delete-student').addEventListener('click', async () => {
  const number = state.editing;
  const student = state.students.find((s) => s.studentNumber === number);
  if (!student || state.busy) return;
  if (!confirm(`Opravdu smazat studenta ${student.name} (#${number})? Smaže se i jeho historie lekcí a postup. Nelze vrátit.`)) return;
  state.busy = true;
  try {
    await api('DELETE', `/api/admin/students/${enc(number)}`);
    if (state.number === number) {
      state.number = null;
      state.edits.clear();
      state.progress = null;
    }
    await loadStudents();
    $('edit-dialog').close();
    Admin.toast('Student smazán.');
  } catch (err) {
    $('edit-dialog').querySelector('.flash').textContent = err.message;
  } finally {
    state.busy = false;
    render();
  }
});

$('detail-close').addEventListener('click', () => {
  if (changeCount() && !confirm('Máte neuložené změny. Zahodit je?')) return;
  state.number = null;
  state.edits.clear();
  state.progress = null;
  render();
});

$('detail-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
});

$('lecturer-filter').addEventListener('change', () => {
  state.lecturer = $('lecturer-filter').value;
  render();
});

// docházka se zapíše jen do pracovní kopie
$('past-rows').addEventListener('change', (e) => {
  const select = e.target.closest('select[data-key]');
  if (!select || state.busy) return;
  const key = select.dataset.key;
  const original = state.lessons.find((l) => lessonKey(l) === key)?.attended;
  const value = select.value === 'true';
  if (value === original) state.edits.delete(key);
  else state.edits.set(key, value);
  render();
});

$('levels').addEventListener('change', (e) => {
  const box = e.target;
  if (!box.matches('input[type="checkbox"][data-kind]') || state.busy) return;
  const level = Number(box.dataset.level);
  if (box.dataset.kind === 'section') {
    if (box.checked) state.sections.add(box.dataset.id);
    else {
      state.sections.delete(box.dataset.id);
      state.tests.delete(level); // test platí jen při splněných podúkolech
    }
  } else if (box.checked) state.tests.add(level);
  else state.tests.delete(level);
  render();
});

$('save').addEventListener('click', () =>
  run(async () => {
    const number = state.number;
    const errors = [];
    let progressSaved = false;

    if (state.edits.size) {
      const records = [...state.edits].map(([key, attended]) => {
        const l = state.lessons.find((x) => lessonKey(x) === key);
        return { lecturer: l.lecturer, date: l.date, hour: l.hour, attended };
      });
      try {
        await api('PUT', `/api/admin/students/${enc(number)}/lessons/records`, { records });
        state.edits.clear();
      } catch (err) {
        errors.push(`Docházka: ${err.message}`);
      }
    }
    if (progressChanges()) {
      try {
        await api('PUT', `/api/admin/students/${enc(number)}/progress`, { sections: [...state.sections], tests: [...state.tests] });
        progressSaved = true;
      } catch (err) {
        errors.push(`Postup: ${err.message}`);
      }
    }
    await loadLessons(number).catch(() => {});
    if (progressSaved) {
      await loadProgress(number).catch(() => {});
      await loadStudents().catch(() => {}); // v tabulce se může změnit level
    }
    if (errors.length) throw new Error(`Uloženo jen částečně. ${errors.join(' ')}`);
    Admin.toast('Uloženo.');
  })
);

$('discard').addEventListener('click', () =>
  run(async () => {
    if (!confirm('Zahodit všechny neuložené změny?')) return;
    state.edits.clear();
    await loadProgress(state.number);
  })
);

window.addEventListener('beforeunload', (e) => {
  if (changeCount()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------- start ---------- */

run(async () => {
  const cfg = await Admin.ready;
  $('lecturer-filter').replaceChildren(new Option('Všichni lektoři', ''), ...cfg.lecturers.map((n) => new Option(n, n)));
  await loadStudents();
});