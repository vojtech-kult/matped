const $ = (id) => document.getElementById(id);

const WEEKDAYS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const state = { data: null, upcoming: null, busy: false };

const fmtDate = (s) => {
  const [, m, d] = s.split('-').map(Number);
  return `${d}. ${m}.`;
};
const fmtLong = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', {
    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
};

// Horní posuvná lišta kalendáře (top-scroll.js), zobrazí se jen když je potřeba
if (typeof enableTopScroll === 'function') enableTopScroll(document.querySelector('.grid-wrap'));

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/student-login.html';
    throw new Error('Nepřihlášen');
  }
  if (!res.ok) throw new Error(data.error ?? 'Chyba');
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Krátké hlášení vpravo nahoře
let toastTimer;
function show(text, isError = false) {
  let box = $('toast');
  if (!box) {
    box = el('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  clearTimeout(toastTimer);
  box.hidden = !text;
  if (!text) return;
  box.textContent = text;
  box.className = isError ? 'toast error' : 'toast';
  toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 8000 : 3500);
}

async function reload() {
  [state.data, state.upcoming] = await Promise.all([
    api('GET', '/api/student/slots'),
    api('GET', '/api/student/bookings'),
  ]);
  render();
}

async function act(method, { lecturer, date, hour }, successText) {
  if (state.busy) return;
  state.busy = true;
  show('');
  try {
    await api(method, '/api/student/bookings', { lecturer, date, hour });
    show(successText);
  } catch (err) {
    show(err.message, true);
  } finally {
    // po každé akci načteme aktuální stav (mezitím mohl místo obsadit někdo jiný)
    try { await reload(); } catch { /* chyba už je zobrazena */ }
    state.busy = false;
  }
}

/* ---------- nadcházející lekce ---------- */

function renderUpcoming() {
  const lessons = state.upcoming?.lessons ?? [];
  $('upcoming-table').hidden = lessons.length === 0;
  $('upcoming-empty').hidden = lessons.length > 0;

  $('upcoming-rows').replaceChildren(
    ...lessons.map((l) => {
      const tr = el('tr');
      const date = el('td', '', fmtLong(l.date));
      if (l.date === state.upcoming.today) date.append(el('span', 'badge', 'Dnes'));

      const actions = el('td', 'actions');
      if (l.cancellable) {
        const cancel = el('button', 'btn btn-sm', 'Zrušit rezervaci');
        cancel.type = 'button';
        cancel.dataset.cancel = '1';
        cancel.dataset.lecturer = l.lecturer;
        cancel.dataset.date = l.date;
        cancel.dataset.hour = l.hour;
        const hover = el('span', 'row-actions');
        hover.append(cancel);
        actions.append(hover);
      }
      tr.append(date, el('td', '', `${l.hour}:00–${l.hour}:50`), el('td', '', l.lecturer), actions);
      return tr;
    })
  );
}

/* ---------- kalendář ---------- */

function makeSlot(day, slot, { capacity, colors }) {
  const full = slot.booked >= capacity;
  // student už má ve stejnou hodinu rezervaci u jiného lektora
  const blocked = !slot.mine && day.slots.some((s) => s.hour === slot.hour && s.mine);
  const label = `${slot.lecturer}, ${WEEKDAYS[day.day - 1]} ${fmtDate(day.date)}, ${slot.hour}:00–${slot.hour}:50`;
  const status = slot.mine
    ? 'vaše rezervace, kliknutím ji zrušíte'
    : blocked
      ? 'v tuto dobu už máte lekci u jiného lektora'
      : full
        ? 'obsazeno'
        : 'volno, kliknutím rezervujete';

  const btn = el('button', 'slot');
  btn.type = 'button';
  if (slot.mine) btn.classList.add('mine');
  if (full) btn.classList.add('full');
  if (blocked) btn.classList.add('blocked');
  btn.disabled = (full && !slot.mine) || blocked;
  btn.style.setProperty('--c', colors[slot.lecturer] ?? '#555');
  btn.dataset.lecturer = slot.lecturer;
  btn.dataset.date = day.date;
  btn.dataset.hour = slot.hour;
  btn.title = `${label}: ${slot.booked}/${capacity}, ${status}`;
  btn.setAttribute('aria-label', `${label}: obsazeno ${slot.booked} z ${capacity}, ${status}`);
  btn.append(el('b', '', slot.lecturer), `${slot.booked}/${capacity}${slot.mine ? ' ✓' : ''}`);
  return btn;
}

function renderLegend({ colors }) {
  const items = Object.entries(colors).map(([name, color]) => {
    const chip = el('span', 'chip', name);
    chip.style.setProperty('--c', color);
    return chip;
  });
  $('legend').replaceChildren(...items, el('span', 'chip full', 'plno'), el('span', '', 'n/m = obsazeno / kapacita, ✓ = vaše rezervace'));
}

function renderGrid() {
  const data = state.data;
  const { days, firstHour, lastHour } = data;
  renderLegend(data);
  $('empty').hidden = days.length > 0;

  const items = [];
  let weekKey = null;
  for (const day of days) {
    const key = `${day.year}-${day.week}`;
    if (key !== weekKey) {
      weekKey = key;
      items.push(el('div', 'week-row', `Týden ${day.week}`));
      items.push(el('div'));
      for (let h = firstHour; h <= lastHour; h++) items.push(el('div', 'head', `${h}:00`));
    }
    const label = el('div', 'day', WEEKDAYS[day.day - 1]);
    label.append(el('small', '', fmtDate(day.date)));
    items.push(label);

    for (let h = firstHour; h <= lastHour; h++) {
      const cell = el('div', 'cell');
      for (const slot of day.slots.filter((s) => s.hour === h)) cell.append(makeSlot(day, slot, data));
      items.push(cell);
    }
  }
  $('grid').replaceChildren(...items);
}

function render() {
  $('credits').textContent = String(state.data.credits ?? 0);
  renderUpcoming();
  renderGrid();
}

/* ---------- události ---------- */

$('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button.slot');
  if (!btn || btn.disabled) return;

  const slot = { lecturer: btn.dataset.lecturer, date: btn.dataset.date, hour: Number(btn.dataset.hour) };
  const label = `${slot.lecturer}, ${fmtDate(slot.date)}, ${slot.hour}:00–${slot.hour}:50`;

  if (btn.classList.contains('mine')) {
    if (!confirm(`Zrušit rezervaci: ${label}?`)) return;
    act('DELETE', slot, `Rezervace zrušena: ${label}`);
  } else {
    act('POST', slot, `Rezervováno: ${label}`);
  }
});

$('upcoming-rows').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cancel]');
  if (!btn) return;
  const slot = { lecturer: btn.dataset.lecturer, date: btn.dataset.date, hour: Number(btn.dataset.hour) };
  const label = `${slot.lecturer}, ${fmtDate(slot.date)}, ${slot.hour}:00–${slot.hour}:50`;
  if (!confirm(`Zrušit rezervaci: ${label}?`)) return;
  act('DELETE', slot, `Rezervace zrušena: ${label}`);
});

reload().catch((err) => show(err.message, true));