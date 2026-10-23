const $ = (id) => document.getElementById(id);
const message = $('message');

async function api(method, url) {
  const res = await fetch(url, { method });
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

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', {
    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
};

const ATTENDANCE_TEXT = new Map([[true, 'Přišel'], [false, 'Nepřišel']]);

function td(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function render({ rows, truncated }) {
  const unpaid = rows.filter((r) => !r.paid).length;
  $('summary').textContent =
    `Záznamů: ${rows.length}, z toho nezaplaceno: ${unpaid}.` +
    (truncated ? ' Zobrazeno jen posledních 1000 lekcí, zúžte prosím filtr.' : '');

  $('rows').replaceChildren(
    ...rows.map((r) => {
      const tr = document.createElement('tr');
      if (!r.paid) tr.className = 'unpaid';

      const link = document.createElement('a');
      link.href = `/admin/students.html?number=${encodeURIComponent(r.studentNumber)}`;
      link.textContent = 'Detail';
      const last = document.createElement('td');
      last.append(link);

      tr.append(
        td(fmtDate(r.date)),
        td(`${r.hour}:00–${r.hour}:50`),
        td(r.lecturer),
        td(`${r.studentNumber} – ${r.name || 'bez jména'}`),
        td(ATTENDANCE_TEXT.get(r.attended) ?? '—'),
        td(r.paid ? 'Zaplaceno' : 'Nezaplaceno', r.paid ? 'paid-yes' : 'paid-no'),
        last
      );
      return tr;
    })
  );
}

async function load() {
  show('');
  const params = new URLSearchParams();
  for (const id of ['from', 'to', 'lecturer', 'paid']) {
    if ($(id).value) params.set(id, $(id).value);
  }
  try {
    render(await api('GET', `/api/admin/lessons/past?${params}`));
  } catch (err) {
    show(err.message, true);
  }
}

$('filters').addEventListener('submit', (e) => {
  e.preventDefault();
  load();
});

(async () => {
  try {
    const cfg = await api('GET', '/api/admin/availability/config');
    for (const name of cfg.lecturers) $('lecturer').append(new Option(name, name));
  } catch (err) {
    show(err.message, true);
  }
  // výchozí rozsah: posledních 30 dní
  const from = new Date();
  from.setDate(from.getDate() - 30);
  $('from').value = isoLocal(from);
  await load();
})();