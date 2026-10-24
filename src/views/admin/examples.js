const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  items: [], // příklady právě zobrazené v seznamu
  truncated: false,
  selected: new Map(), // id -> { id, label }; zůstává i po změně kategorie, v pořadí zaškrtnutí
  busy: false,
  urls: [], // adresy vygenerovaných PDF (uvolňují se při dalším generování)
};

const MATH_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\begin{align*}', right: '\\end{align*}', display: true },
    { left: '\\begin{equation*}', right: '\\end{equation*}', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
};

const { api, el } = Admin;

const REQUIRED_IDS = [
  'tabs', 'panel-pdf', 'panel-upload', 'sel-count', 'pdf-title', 'generate', 'clear-selection', 'status', 'results',
  'result-links', 'label', 'sort', 'min', 'max', 'select-all', 'list-hint', 'list', 'create-form', 'new-label',
  'new-difficulty', 'new-code', 'create-error',
];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) {
  Admin.toast(`Chybí prvky stránky: ${missing.join(', ')}`, true);
  throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);
}

// Stav (zprávy o výsledku jdou jako hlášení vpravo nahoře)
const show = (text, isError = false) => Admin.toast(text, isError);

function renderMath(root) {
  if (typeof window.renderMathInElement === 'function') window.renderMathInElement(root, MATH_OPTIONS);
}

// V náhledu se obrázky (tikz) nahradí zástupným textem
const previewText = (s) => s.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '[obrázek]');

/* ---------- načítání ---------- */

function fillLabels() {
  const { labels, counts } = state.config;
  const current = $('label').value;
  $('label').replaceChildren(
    new Option('— vyberte kategorii —', ''),
    ...labels.map((l) => new Option(`${l} (${counts[l] ?? 0})`, l))
  );
  $('label').value = current;

  if (!$('new-label').options.length) {
    $('new-label').replaceChildren(...labels.map((l) => new Option(l, l)));
  }
}

async function loadConfig() {
  state.config = await api('GET', '/api/admin/examples/config');
  fillLabels();
}

async function loadList() {
  const label = $('label').value;
  if (!label) {
    state.items = [];
    state.truncated = false;
    renderList();
    return;
  }
  const params = new URLSearchParams({ label, sort: $('sort').value });
  if ($('min').value) params.set('min', $('min').value);
  if ($('max').value) params.set('max', $('max').value);

  const data = await api('GET', `/api/admin/examples?${params}`);
  state.items = data.items;
  state.truncated = data.truncated;
  renderList();
}

const refresh = async () => {
  await loadConfig();
  await loadList();
};

/* ---------- vykreslení ---------- */

function rowElement(item) {
  const li = el('li', 'example');
  li.dataset.id = item.id;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.id = item.id;
  box.disabled = Boolean(item.error);

  const body = el('div', 'example-body');
  body.append(
    el('div', 'example-preview', previewText(item.zadani ?? '')),
    el('div', 'example-meta', `Obtížnost ${item.difficulty}/10`)
  );
  if (item.error) body.append(el('div', 'example-error', `Neplatný kód: ${item.error}`));

  const pick = el('label', 'example-pick');
  pick.append(box, body);

  const details = el('details');
  details.append(el('summary', '', 'Zobrazit LaTeX kód'), el('pre', '', item.code));

  const main = el('div', 'example-main');
  main.append(pick, details);

  const del = el('button', 'btn btn-sm', 'Smazat');
  del.type = 'button';
  del.dataset.action = 'delete';
  del.dataset.id = item.id;
  const actions = el('span', 'row-actions');
  actions.append(del);

  li.append(main, actions);
  return li;
}

function renderList() {
  const list = $('list');
  if (!$('label').value) {
    list.replaceChildren();
    $('list-hint').textContent = 'Nejdřív vyberte kategorii.';
  } else if (!state.items.length) {
    list.replaceChildren();
    $('list-hint').textContent = 'V této kategorii nejsou žádné příklady odpovídající filtru.';
  } else {
    list.replaceChildren(...state.items.map(rowElement));
    $('list-hint').textContent =
      `Zobrazeno: ${state.items.length}` + (state.truncated ? ' (jen prvních 500, zúžte filtr)' : '');
    renderMath(list);
  }
  updateSelection();
}

function updateSelection() {
  const n = state.selected.size;
  const byLabel = new Map();
  for (const s of state.selected.values()) byLabel.set(s.label, (byLabel.get(s.label) ?? 0) + 1);
  const detail = [...byLabel].map(([label, count]) => `${label}: ${count}`).join(', ');

  $('sel-count').textContent = n ? `Vybráno: ${n} (${detail})` : 'Vybráno: 0';
  $('generate').disabled = n === 0 || state.busy;
  $('clear-selection').disabled = n === 0 || state.busy;
  $('select-all').disabled = state.items.length === 0;

  for (const li of $('list').children) {
    const on = state.selected.has(li.dataset.id);
    li.classList.toggle('selected', on);
    li.querySelector('input[type="checkbox"]').checked = on;
  }
}

/* ---------- události ---------- */

for (const id of ['label', 'sort', 'min', 'max']) {
  $(id).addEventListener('change', () => {
    show('');
    loadList().catch((err) => show(err.message, true));
  });
}

$('list').addEventListener('change', (e) => {
  const box = e.target.closest('input[type="checkbox"][data-id]');
  if (!box) return;
  const item = state.items.find((i) => i.id === box.dataset.id);
  if (!item) return;

  if (box.checked) {
    if (state.selected.size >= state.config.maxPdf) {
      show(`Najednou lze vybrat nejvýše ${state.config.maxPdf} příkladů.`, true);
    } else {
      state.selected.set(item.id, { id: item.id, label: item.label });
    }
  } else {
    state.selected.delete(item.id);
  }
  updateSelection(); // sjednotí zaškrtnutí s výběrem
});

$('list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="delete"]');
  if (!btn || state.busy) return;
  if (!confirm('Opravdu smazat tento příklad z databáze?')) return;

  state.busy = true;
  try {
    await api('DELETE', `/api/admin/examples/${encodeURIComponent(btn.dataset.id)}`);
    state.selected.delete(btn.dataset.id);
    show('Příklad smazán.');
    await refresh();
  } catch (err) {
    show(err.message, true);
  } finally {
    state.busy = false;
    updateSelection();
  }
});

$('select-all').addEventListener('click', () => {
  for (const item of state.items) {
    if (item.error || state.selected.has(item.id)) continue;
    if (state.selected.size >= state.config.maxPdf) {
      show(`Najednou lze vybrat nejvýše ${state.config.maxPdf} příkladů.`, true);
      break;
    }
    state.selected.set(item.id, { id: item.id, label: item.label });
  }
  updateSelection();
});

$('clear-selection').addEventListener('click', () => {
  state.selected.clear();
  updateSelection();
});

$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  state.busy = true;
  $('create-error').textContent = '';
  try {
    await api('POST', '/api/admin/examples', {
      label: $('new-label').value,
      difficulty: Number($('new-difficulty').value),
      code: $('new-code').value,
    });
    $('new-code').value = '';
    show('Příklad přidán.');
    await refresh();
  } catch (err) {
    $('create-error').textContent = err.message;
  } finally {
    state.busy = false;
    updateSelection();
  }
});

function pdfUrl(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

// Název stahovaného souboru podle zadaného názvu (bez diakritiky), např. „Zlomky 7.A“ -> zlomky-7-a.pdf
function downloadName(original) {
  const slug = $('pdf-title').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug ? original.replace(/^zadani/, slug) : original;
}

function showResults(files) {
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls = [];

  const links = files.map((file) => {
    const url = pdfUrl(file.data);
    state.urls.push(url);
    const a = el('a', 'btn btn-primary', `Stáhnout: ${file.label} (PDF)`);
    a.href = url;
    a.download = downloadName(file.name);
    return a;
  });
  $('result-links').replaceChildren(...links);
  $('results').hidden = false;
}

$('generate').addEventListener('click', async () => {
  if (state.busy || !state.selected.size) return;
  state.busy = true;
  updateSelection();
  $('status').textContent = 'Generuji PDF, může to trvat několik sekund…';
  try {
    const data = await api('POST', '/api/admin/examples/pdf', {
      ids: [...state.selected.keys()],
      title: $('pdf-title').value,
    });
    showResults(data.files);
    $('status').textContent = '';
    show('PDF je připravené ke stažení.');
  } catch (err) {
    $('status').textContent = '';
    show(err.message, true);
  } finally {
    state.busy = false;
    updateSelection();
  }
});

/* ---------- přepínač částí ---------- */

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  for (const t of $('tabs').querySelectorAll('[data-tab]')) t.setAttribute('aria-pressed', String(t === b));
  $('panel-pdf').hidden = b.dataset.tab !== 'pdf';
  $('panel-upload').hidden = b.dataset.tab !== 'upload';
});

/* ---------- start ---------- */

(async () => {
  try {
    await loadConfig();
    renderList();
  } catch (err) {
    show(err.message, true);
  }
})();