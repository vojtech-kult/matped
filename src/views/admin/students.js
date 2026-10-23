const $ = (id) => document.getElementById(id);
const message = $('message'); // zpráva v liště „Uložit změny“
const flashBox = $('flash'); // zpráva ke správě účtů
const enc = encodeURIComponent;

const state = {
  students: [], // přehled všech studentů (včetně levelu)
  number: null, // vybraný student
  busy: false,
  // lekce, docházka a platby
  lessons: [],
  edits: new Map(), // klíč lekce -> { attended?, paid? } (jen neuložené změny)
  // postup v kurzu
  progress: null, // poslední stav ze serveru (osnova, XP konstanty)
  sections: new Set(), // pracovní kopie: splněné podúkoly
  tests: new Set(), // pracovní kopie: splněné testy
  saved: { sections: new Set(), tests: new Set() },
  open: new Set(),
  editing: null,
};

/* ---------- společné ---------- */

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

function setFlash(box, text, isError = false) {
  box.textContent = text;
  box.style.color = isError ? 'crimson' : 'green';
}
const flash = (text, isError = false) => setFlash(flashBox, text, isError);

function textCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

const diffCount = (a, b) =>
  [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
const progressChanges = () =>
  state.progress
    ? diffCount(state.sections, state.saved.sections) + diffCount(state.tests, state.saved.tests)
    : 0;
const changeCount = () => state.edits.size + progressChanges();

function updateSaveBar() {
  const lessonsN = state.edits.size;
  const progressN = progressChanges();
  const total = lessonsN + progressN;

  $('save').disabled = total === 0 || state.busy;
  $('discard').disabled = total === 0 || state.busy;

  const parts = [];
  if (lessonsN) parts.push(`lekce: ${lessonsN}`);
  if (progressN) parts.push(`postup: ${progressN}`);
  $('dirty').textContent = total ? `Neuložené změny: ${total} (${parts.join(', ')})` : '';
}

/* ---------- tabulka studentů a výběr ---------- */

function renderStudents() {
  $('students-empty').hidden = state.students.length > 0;
  $('students').replaceChildren(
    ...state.students.map((s) => {
      const tr = document.createElement('tr');
      if (s.studentNumber === state.number) tr.className = 'selected-row';

      const level = document.createElement('td');
      if (s.courseCompleted) {
        level.textContent = 'Kurz dokončen ✓';
      } else {
        const bar = document.createElement('progress');
        bar.max = 100;
        bar.value = s.levelPercent;
        level.append(`Level ${s.level} · ${s.levelPercent} % `, bar);
      }

      const detail = document.createElement('button');
      detail.type = 'button';
      detail.className = 'btn';
      detail.dataset.number = s.studentNumber;
      detail.textContent = 'Detail';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn';
      edit.dataset.edit = s.studentNumber;
      edit.textContent = 'Upravit';

      const action = document.createElement('td');
      action.append(detail, ' ', edit);

      tr.append(textCell(s.studentNumber), textCell(s.name || '—'), level, action);
      return tr;
    })
  );
}

function fillDropdown() {
  $('student').replaceChildren(
    ...state.students.map((s) => new Option(`${s.studentNumber} – ${s.name || 'bez jména'}`, s.studentNumber))
  );
  if (state.number) $('student').value = state.number;
}

async function loadStudents() {
  state.students = await api('GET', '/api/admin/students');
  fillDropdown();
  renderStudents();
}

/* ---------- lekce, docházka, platby ---------- */

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', {
    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
};

const lessonKey = (l) => `${l.lecturer}|${l.date}|${l.hour}`;

// Hodnoty po započtení neuložených úprav
function current(lesson) {
  const edit = state.edits.get(lesson.key) ?? {};
  return {
    attended: 'attended' in edit ? edit.attended : lesson.attended,
    paid: 'paid' in edit ? edit.paid : lesson.paid,
  };
}

function selectCell(field, lesson, options, value) {
  const select = document.createElement('select');
  select.dataset.field = field;
  select.dataset.key = lesson.key;
  for (const [optValue, label] of options) select.append(new Option(label, optValue));
  select.value = value;
  const td = document.createElement('td');
  td.append(select);
  return td;
}

const ATTENDANCE = [['', '— nezapsáno'], ['yes', 'Přišel'], ['no', 'Nepřišel']];
const PAID = [['no', 'Ne'], ['yes', 'Ano']];

function lessonRow(lesson, withAttendance) {
  const now = current(lesson);
  const tr = document.createElement('tr');
  if (state.edits.has(lesson.key)) tr.className = 'changed';
  tr.append(
    textCell(fmtDate(lesson.date)),
    textCell(`${lesson.hour}:00–${lesson.hour}:50`),
    textCell(lesson.lecturer)
  );
  if (withAttendance) {
    const value = now.attended === null ? '' : now.attended ? 'yes' : 'no';
    tr.append(selectCell('attended', lesson, ATTENDANCE, value));
  }
  tr.append(selectCell('paid', lesson, PAID, now.paid ? 'yes' : 'no'));
  return tr;
}

function renderLessonsSummary() {
  if (!state.number) {
    $('lessons-summary').textContent = 'Není vybrán žádný student.';
    return;
  }
  const past = state.lessons.filter((l) => l.past);
  const values = past.map(current);
  const came = values.filter((v) => v.attended === true).length;
  const missed = values.filter((v) => v.attended === false).length;
  const unwritten = values.filter((v) => v.attended === null).length;
  const unpaid = values.filter((v) => !v.paid).length;
  $('lessons-summary').textContent = state.lessons.length
    ? `Proběhlo: ${past.length} (přišel: ${came}, nepřišel: ${missed}, bez zápisu: ${unwritten}). ` +
      `Nezaplacených proběhlých lekcí: ${unpaid}. Naplánovaných: ${state.lessons.length - past.length}.`
    : '';
}

function renderLessons() {
  const past = state.lessons.filter((l) => l.past);
  const upcoming = state.lessons.filter((l) => !l.past);

  $('past').replaceChildren(...past.map((l) => lessonRow(l, true)));
  $('upcoming').replaceChildren(...upcoming.map((l) => lessonRow(l, false)));
  $('past-empty').hidden = past.length > 0 || !state.number;
  $('upcoming-empty').hidden = upcoming.length > 0 || !state.number;
  renderLessonsSummary();
  updateSaveBar();
}

async function loadLessons(number) {
  const data = await api('GET', `/api/admin/students/${enc(number)}/lessons`);
  if (number !== state.number) return; // mezitím byl vybrán jiný student
  state.lessons = data.lessons.map((l) => ({ ...l, key: lessonKey(l) }));
  // úpravy lekcí, které už neexistují, zahodíme
  const keys = new Set(state.lessons.map((l) => l.key));
  for (const k of [...state.edits.keys()]) if (!keys.has(k)) state.edits.delete(k);
  renderLessons();
}

// Změna políčka se zapíše jen do paměti
function onLessonChange(select) {
  if (state.busy) {
    renderLessons();
    return;
  }
  const lesson = state.lessons.find((l) => l.key === select.dataset.key);
  if (!lesson) return;

  const field = select.dataset.field;
  const value = field === 'attended' ? (select.value === '' ? null : select.value === 'yes') : select.value === 'yes';

  const edit = { ...(state.edits.get(lesson.key) ?? {}) };
  if (value === lesson[field]) delete edit[field];
  else edit[field] = value;

  if (Object.keys(edit).length) state.edits.set(lesson.key, edit);
  else state.edits.delete(lesson.key);

  select.closest('tr').classList.toggle('changed', state.edits.has(lesson.key));
  renderLessonsSummary();
  updateSaveBar();
}

for (const id of ['past', 'upcoming']) {
  $(id).addEventListener('change', (e) => {
    if (e.target.matches('select[data-field]')) onLessonChange(e.target);
  });
}

/* ---------- postup v kurzu ---------- */

// Stav levelů spočítaný z pracovní kopie (stejná pravidla jako na serveru)
function progressView() {
  const { levels, xpPerSection, xpPerTest } = state.progress;
  let xp = 0;
  const out = levels.map((l) => {
    const sections = l.sections.map((s) => ({ ...s, done: state.sections.has(s.id) }));
    const doneCount = sections.filter((s) => s.done).length;
    const testPassed = doneCount === l.total && state.tests.has(l.level);
    xp += doneCount * xpPerSection + (testPassed ? xpPerTest : 0);
    return {
      ...l,
      sections,
      doneCount,
      percent: Math.round((doneCount / l.total) * 100),
      testPassed,
      completed: testPassed,
    };
  });
  const currentLevel = out.find((l) => !l.completed);
  for (const l of out) l.status = l.completed ? 'completed' : l === currentLevel ? 'current' : 'upcoming';
  return { levels: out, current: currentLevel, xp };
}

function checkbox(kind, level, id, checked) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.dataset.kind = kind;
  box.dataset.level = level;
  if (id) box.dataset.id = id;
  return box;
}

function levelElement(l) {
  const details = document.createElement('details');
  details.className = `level ${l.status}`;
  details.open = state.open.has(l.level);
  details.addEventListener('toggle', () => {
    if (details.open) state.open.add(l.level);
    else state.open.delete(l.level);
  });

  const summary = document.createElement('summary');
  const status = l.completed ? ' ✓ splněno' : l.status === 'current' ? ' (aktuální)' : '';
  const bar = document.createElement('progress');
  bar.max = l.total;
  bar.value = l.doneCount;
  summary.append(`Level ${l.level}: ${l.title} – ${l.doneCount}/${l.total} (${l.percent} %)${status} `, bar);
  details.append(summary);

  const checks = document.createElement('div');
  checks.className = 'checks';
  for (const s of l.sections) {
    const label = document.createElement('label');
    if (s.done !== state.saved.sections.has(s.id)) label.className = 'changed';
    label.append(checkbox('section', l.level, s.id, s.done), ` ${s.title}`);
    checks.append(label);
  }
  details.append(checks);

  const allDone = l.doneCount === l.total;
  const testRow = document.createElement('div');
  testRow.className = 'test-row';
  const testLabel = document.createElement('label');
  if (l.testPassed !== state.saved.tests.has(l.level)) testLabel.className = 'changed';
  const testBox = checkbox('test', l.level, null, l.testPassed);
  testBox.disabled = !allDone;
  testLabel.append(
    testBox,
    ` Závěrečný test úrovně napsán a splněn${allDone ? '' : ' (nejdřív musí být splněny všechny podúkoly)'}`
  );
  testRow.append(testLabel);
  details.append(testRow);

  return details;
}

function renderProgress() {
  if (!state.progress) {
    $('progress-summary').textContent = state.number ? '' : 'Není vybrán žádný student.';
    $('levels').replaceChildren();
    updateSaveBar();
    return;
  }
  const v = progressView();
  const { maxXp } = state.progress;
  $('progress-summary').textContent = v.current
    ? `Aktuální level: ${v.current.level} z ${v.levels.length}. XP: ${v.xp} / ${maxXp}`
    : `Kurz je dokončen. XP: ${v.xp} / ${maxXp}`;
  $('levels').replaceChildren(...v.levels.map(levelElement));
  updateSaveBar();
}

async function loadProgress(number, resetOpen = false) {
  const data = await api('GET', `/api/admin/students/${enc(number)}/progress`);
  if (number !== state.number) return;
  state.progress = data;
  state.sections = new Set(data.levels.flatMap((l) => l.sections.filter((s) => s.done).map((s) => s.id)));
  state.tests = new Set(data.levels.filter((l) => l.testPassed).map((l) => l.level));
  state.saved = { sections: new Set(state.sections), tests: new Set(state.tests) };
  if (resetOpen) state.open = new Set(data.currentLevel ? [data.currentLevel] : []);
  renderProgress();
}

// Zaškrtnutí se zapíše jen do pracovní kopie
$('levels').addEventListener('change', (e) => {
  const box = e.target;
  if (!box.matches('input[type="checkbox"][data-kind]')) return;
  if (state.busy) {
    renderProgress();
    return;
  }

  const level = Number(box.dataset.level);
  if (box.dataset.kind === 'section') {
    if (box.checked) {
      state.sections.add(box.dataset.id);
    } else {
      state.sections.delete(box.dataset.id);
      state.tests.delete(level); // test pokrývá celou úroveň, takže se ruší s odškrtnutým podúkolem
    }
  } else if (box.checked) {
    state.tests.add(level);
  } else {
    state.tests.delete(level);
  }
  renderProgress();
});

/* ---------- výběr studenta ---------- */

function clearDetail() {
  state.number = null;
  state.edits.clear();
  state.lessons = [];
  state.progress = null;
  state.sections = new Set();
  state.tests = new Set();
  state.saved = { sections: new Set(), tests: new Set() };
  renderStudents();
  renderLessons();
  renderProgress();
}

async function loadStudent(number) {
  clearDetail();
  state.number = number;
  if ($('student').value !== number) $('student').value = number;
  renderStudents();
  renderLessons();
  await Promise.all([loadLessons(number), loadProgress(number, true)]);
}

async function chooseStudent(number, { scroll = false } = {}) {
  if (number !== state.number) {
    if (changeCount() && !confirm('Máte neuložené změny. Přepnutím studenta se zahodí. Pokračovat?')) {
      $('student').value = state.number ?? '';
      return;
    }
    history.replaceState(null, '', `?number=${enc(number)}`);
    show('');
  }
  if (scroll) $('detail').scrollIntoView({ behavior: 'smooth' });
  if (number !== state.number) await loadStudent(number);
}

$('student').addEventListener('change', () =>
  chooseStudent($('student').value).catch((err) => show(err.message, true))
);

$('students').addEventListener('click', (e) => {
  const detail = e.target.closest('button[data-number]');
  if (detail) {
    chooseStudent(detail.dataset.number, { scroll: true }).catch((err) => show(err.message, true));
    return;
  }
  const edit = e.target.closest('button[data-edit]');
  if (edit) openEdit(edit.dataset.edit);
});

/* ---------- ukládání ---------- */

$('save').addEventListener('click', async () => {
  if (state.busy || !changeCount()) return;
  state.busy = true;
  updateSaveBar();
  show('');

  const number = state.number;
  const errors = [];
  let progressSaved = false;

  if (state.edits.size) {
    const records = [...state.edits].map(([key, edit]) => {
      const l = state.lessons.find((x) => x.key === key);
      return { lecturer: l.lecturer, date: l.date, hour: l.hour, ...edit };
    });
    try {
      await api('PUT', `/api/admin/students/${enc(number)}/lessons/records`, { records });
      state.edits.clear();
    } catch (err) {
      errors.push(`Lekce: ${err.message}`); // úpravy zůstávají, jde to zkusit znovu
    }
  }

  if (progressChanges()) {
    try {
      await api('PUT', `/api/admin/students/${enc(number)}/progress`, {
        sections: [...state.sections],
        tests: [...state.tests],
      });
      progressSaved = true;
    } catch (err) {
      errors.push(`Postup: ${err.message}`); // pracovní kopie zůstává
    }
  }

  state.busy = false;
  // Znovu načteme jen to, co se uložilo (neuložené úpravy se nesmí přepsat)
  await loadLessons(number).catch(() => {});
  if (progressSaved) {
    await loadProgress(number).catch(() => {});
    await loadStudents().catch(() => {}); // v tabulce se může změnit level
  }
  updateSaveBar();

  if (errors.length) show(`Uloženo jen částečně. ${errors.join(' ')}`, true);
  else show('Změny uloženy.');
});

$('discard').addEventListener('click', () => {
  if (!changeCount() || !confirm('Zahodit všechny neuložené změny?')) return;
  state.edits.clear();
  if (state.progress) {
    state.sections = new Set(state.saved.sections);
    state.tests = new Set(state.saved.tests);
  }
  show('Změny zahozeny.');
  renderLessons();
  renderProgress();
});

window.addEventListener('beforeunload', (e) => {
  if (changeCount()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------- správa účtů (modální okna) ---------- */

const createDialog = $('create-dialog');
const editDialog = $('edit-dialog');
const createFlash = $('create-flash');
const editFlash = $('edit-flash');

// Zavření: tlačítko s data-close, klik na pozadí nebo Esc. Při zavření se formuláře i zprávy vyčistí.
for (const dialog of document.querySelectorAll('dialog.modal')) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.querySelectorAll('form').forEach((f) => f.reset());
    dialog.querySelectorAll('.flash').forEach((box) => setFlash(box, ''));
  });
}

$('open-create').addEventListener('click', () => {
  flash('');
  createDialog.showModal();
  createDialog.querySelector('input').focus();
});

function openEdit(number) {
  const student = state.students.find((s) => s.studentNumber === number);
  if (!student) return;
  flash('');
  state.editing = number;
  $('edit-title').textContent = `Úprava studenta ${number}`;
  $('name-form').elements.namedItem('name').value = student.name ?? '';
  editDialog.showModal();
}

// Po vytvoření, přejmenování nebo smazání studenta znovu načte tabulku a srovná výběr
async function afterAccountChange() {
  await loadStudents();
  if (!state.students.length) {
    clearDetail();
    return;
  }
  if (!state.students.some((s) => s.studentNumber === state.number)) {
    const first = state.students[0].studentNumber;
    history.replaceState(null, '', `?number=${enc(first)}`);
    await loadStudent(first);
  }
}

// Společné odeslání formulářů v oknech. handler vrátí false, pokud se akce zrušila.
function accountForm(formId, box, handler) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setFlash(box, '');
    button.disabled = true;
    try {
      const result = await handler(Object.fromEntries(new FormData(form)), form);
      if (result !== false) await afterAccountChange();
    } catch (err) {
      setFlash(box, err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

accountForm('create-form', createFlash, async ({ studentNumber, name, password }) => {
  await api('POST', '/api/admin/students', { studentNumber, name, password });
  createDialog.close();
  flash(`Student ${studentNumber} vytvořen.`);
});

accountForm('name-form', editFlash, async ({ name }) => {
  await api('PATCH', `/api/admin/students/${enc(state.editing)}/name`, { name });
  setFlash(editFlash, 'Jméno změněno.');
});

accountForm('password-form', editFlash, async ({ password }, form) => {
  await api('PATCH', `/api/admin/students/${enc(state.editing)}/password`, { password });
  form.reset();
  setFlash(editFlash, 'Heslo změněno. Student byl odhlášen ze všech zařízení.');
});

accountForm('delete-form', editFlash, async () => {
  const number = state.editing;
  if (!confirm(`Opravdu smazat studenta ${number}? Smaže se i jeho docházka, platby a postup v kurzu.`)) {
    return false;
  }
  await api('DELETE', `/api/admin/students/${enc(number)}`);
  editDialog.close();
  flash(`Student ${number} smazán.`);
});

/* ---------- start ---------- */

(async () => {
  try {
    await loadStudents();
    if (!state.students.length) {
      clearDetail();
      return;
    }
    const wanted = new URLSearchParams(location.search).get('number');
    const number = state.students.some((s) => s.studentNumber === wanted)
      ? wanted
      : state.students[0].studentNumber;
    await loadStudent(number);
  } catch (err) {
    flash(err.message, true);
  }
})();