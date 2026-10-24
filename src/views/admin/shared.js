// Společné pomocné funkce nového admin rozhraní. Vše je v jediném globálním objektu Admin.
(() => {
  const STORAGE_KEY = 'matped.admin.lecturer';
  const readStored = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
  const writeStored = (v) => { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* bez ukládání */ } };

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

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Krátké hlášení vpravo dole
  let toastTimer;
  function toast(text, isError = false) {
    let box = document.getElementById('toast');
    if (!box) {
      box = el('div');
      box.id = 'toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.hidden = true;
      document.body.append(box);
    }
    clearTimeout(toastTimer);
    if (!text) {
      box.hidden = true;
      return;
    }
    box.textContent = text;
    box.className = isError ? 'toast error' : 'toast';
    box.hidden = false;
    toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 8000 : 3500);
  }

  /* ---------- data a čas (data jsou řetězce YYYY-MM-DD) ---------- */
  const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('cs-CZ', { ...opts, timeZone: 'UTC' });
  };
  const timeRange = (hour) => `${hour}:00–${hour}:50`;

  /* ---------- výběr lektora v horní liště ---------- */
  const listeners = [];
  let current = '';

  const ready = (async () => {
    const cfg = await api('GET', '/api/admin/availability/config');
    const select = document.getElementById('lecturer-select');
    select.replaceChildren(...cfg.lecturers.map((name) => new Option(name, name)));
    const stored = readStored();
    current = cfg.lecturers.includes(stored) ? stored : cfg.lecturers[0];
    select.value = current;

    select.addEventListener('change', () => {
      const hook = window.Admin.beforeLecturerChange;
      if (hook && !hook()) {
        select.value = current; // změnu lektora stránka zamítla
        return;
      }
      current = select.value;
      writeStored(current);
      for (const fn of listeners) fn(current);
    });
    return cfg; // { lecturers, firstHour, lastHour }
  })();
  ready.catch(() => {});

  window.Admin = {
    api, el, toast, fmtDate, timeRange, ready,
    get lecturer() { return current; },
    onLecturerChange(fn) { listeners.push(fn); },
    beforeLecturerChange: null, // stránka může nastavit funkci vracející false = změnu lektora zrušit
  };
})();
