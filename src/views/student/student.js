const $ = (id) => document.getElementById(id);
const message = $('message');

enableTopScroll(document.querySelector('.grid-wrap'));

const WEEKDAYS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const state = { data: null, busy: false };

const fmtDate = (s) => {
  const [, m, d] = s.split('-').map(Number);
  return `${d}. ${m}.`;
};

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

function show(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? 'crimson' : 'green';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function reload() {
  state.data = await api('GET', '/api/student/slots');
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

function makeSlot(day, slot, { capacity, colors }) {
  const full = slot.booked >= capacity;
  const label = `${slot.lecturer}, ${WEEKDAYS[day.day - 1]} ${fmtDate(day.date)}, ${slot.hour}:00–${slot.hour}:50`;
  const status = slot.mine
    ? 'vaše rezervace, kliknutím ji zrušíte'
    : full
      ? 'obsazeno'
      : 'volno, kliknutím rezervujete';

  const btn = el('button', 'slot');
  btn.type = 'button';
  if (slot.mine) btn.classList.add('mine');
  if (full) btn.classList.add('full');
  btn.disabled = full && !slot.mine;
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
  const full = el('span', 'chip full', 'plno');
  const info = el('span', '', 'Číslo n/m = obsazeno / kapacita, ✓ = vaše rezervace');
  $('legend').replaceChildren(...items, full, info);
}

function render() {
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
      for (const slot of day.slots.filter((s) => s.hour === h)) {
        cell.append(makeSlot(day, slot, data));
      }
      items.push(cell);
    }
  }
  $('grid').replaceChildren(...items);
}

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

(async () => {
  try {
    const me = await api('GET', '/api/auth/me');
    $('who').textContent = me.identifier;
    await reload();
  } catch (err) {
    show(err.message, true);
  }
})();