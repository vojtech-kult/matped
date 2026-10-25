const $ = (id) => document.getElementById(id);

const REQUIRED_IDS = ['summary', 'sum-text', 'sum-bar', 'filter', 'levels', 'empty', 'empty-text',
  'ask-dialog', 'ask-form', 'ask-video', 'ask-message', 'ask-error', 'ask-cancel', 'ask-send'];
const missing = REQUIRED_IDS.filter((id) => !$(id));
if (missing.length) throw new Error(`Chybí prvky stránky: ${missing.join(', ')}`);

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

let toastTimer;
function toast(text, isError = false) {
  let box = $('toast');
  if (!box) {
    box = el('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  clearTimeout(toastTimer);
  box.textContent = text;
  box.className = isError ? 'toast error' : 'toast';
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 8000 : 3500);
}

const API = '/api/student/materials';

const state = { data: null, filter: 'all', busy: false, focus: null, askVideo: null };

async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

const allVideos = () => state.data.levels.flatMap((l) => l.sections.flatMap((s) => s.videos));
const findVideo = (id) => allVideos().find((v) => v.id === id);

/* ---------- vykreslení ---------- */

function matches(v) {
  if (state.filter === 'todo') return !v.watched;
  if (state.filter === 'help') return v.understood === 'no';
  return true;
}

function render() {
  const d = state.data;
  if (!d) return;

  const hasVideos = d.enabled && d.total > 0;
  $('summary').hidden = !hasVideos;
  $('empty').hidden = hasVideos;
  if (!hasVideos) {
    $('empty-text').textContent = d.enabled
      ? 'K vašemu kurzu zatím nejsou přidaná žádná videa.'
      : 'Máte nastavený vlastní kurz, ke kterému nejsou videa. Případné materiály vám ukáže lektor.';
  }

  if (hasVideos) {
    $('sum-text').textContent = `Zhlédnuto ${d.watched} z ${d.total}`;
    $('sum-bar').style.width = `${Math.round((d.watched / d.total) * 100)}%`;
    for (const b of $('filter').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
  }

  const cards = [];
  for (const level of d.levels) {
    const sections = level.sections
      .map((s) => ({ ...s, shown: s.videos.filter(matches) }))
      .filter((s) => s.shown.length);
    if (!sections.length) continue;

    const all = level.sections.flatMap((s) => s.videos);
    const card = el('section', 'card mat-level');
    const head = el('div', 'mat-level-head');
    head.append(
      el('span', 'mat-num', String(level.level)),
      el('h2', undefined, level.title),
      el('span', 'mat-count', `${all.filter((v) => v.watched).length} / ${all.length} zhlédnuto`)
    );
    card.append(head);
    for (const s of sections) {
      const box = el('div', 'mat-section');
      box.append(el('h3', undefined, s.title));
      const list = el('ul', 'mat-videos');
      for (const v of s.shown) list.append(videoItem(v));
      box.append(list);
      card.append(box);
    }
    cards.push(card);
  }
  $('levels').replaceChildren(...cards);
  if (hasVideos && !cards.length) {
    const none = el('section', 'card');
    none.append(el('p', 'empty-note', 'V tomto filtru nejsou žádná videa.'));
    $('levels').append(none);
  }

  if (state.focus) {
    document.querySelector(state.focus)?.focus();
    state.focus = null;
  }
}

function videoItem(v) {
  const li = el('li', `mat-video${v.watched ? ' done' : ''}${v.understood === 'no' ? ' help' : ''}`);
  li.dataset.vid = v.id;

  const info = el('div', 'mat-info');
  info.append(el('span', 'mat-title', v.title));
  const link = el('a', 'mat-link', 'Otevřít na YouTube');
  link.href = v.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  info.append(link);

  const controls = el('div', 'mat-controls');
  const check = el('label', 'mat-check');
  const box = el('input', 'mat-watched');
  box.type = 'checkbox';
  box.checked = v.watched;
  box.addEventListener('change', () => setProgress(v, { watched: box.checked }, '.mat-watched'));
  check.append(box, 'Zhlédnuto');

  const rate = el('div', 'seg mat-rate');
  rate.setAttribute('role', 'group');
  rate.setAttribute('aria-label', 'Jak vám video pomohlo');
  const yes = el('button', 'mat-yes', 'Chápu');
  const no = el('button', 'mat-no', 'Potřebuji dovysvětlit');
  for (const [b, value] of [[yes, 'yes'], [no, 'no']]) {
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v.understood === value));
  }
  yes.addEventListener('click', () => setProgress(v, { understood: v.understood === 'yes' ? null : 'yes' }, '.mat-yes'));
  no.addEventListener('click', async () => {
    if (v.understood === 'no') return openAsk(v); // už je zvoleno, jen znovu otevře formulář
    await setProgress(v, { understood: 'no' }, '.mat-no');
    if (findVideo(v.id)?.understood === 'no') openAsk(v);
  });
  rate.append(yes, no);
  controls.append(check);
  if (v.watched) controls.append(rate); // hodnocení se ukáže, až když je video zhlédnuté
  li.append(info, controls);

  if (v.understood === 'no') {
    const note = el('p', 'mat-note');
    if (v.asked) note.append('Váš dotaz jsme dostali. ');
    const again = el('button', 'mat-ask', v.asked ? 'Napsat další upřesnění' : 'Napsat, co vám nebylo jasné');
    again.type = 'button';
    again.addEventListener('click', () => openAsk(v));
    note.append(again);
    li.append(note);
  }
  return li;
}

/* ---------- ukládání ---------- */

function setProgress(v, patch, focusClass) {
  return run(async () => {
    state.focus = `[data-vid="${v.id}"] ${focusClass}`;
    await api('PUT', `${API}/${encodeURIComponent(v.id)}/progress`, patch);
    const d = state.data;
    if ('watched' in patch) {
      d.watched += patch.watched ? 1 : -1;
      if (!patch.watched) {
        if (v.understood === 'yes') d.understood -= 1;
        v.understood = null;
      }
      v.watched = patch.watched;
    }
    if ('understood' in patch) {
      if (v.understood === 'yes') d.understood -= 1;
      v.understood = patch.understood;
      if (v.understood === 'yes') d.understood += 1;
    }
  });
}

/* ---------- formulář „co vám nebylo jasné“ ---------- */

function openAsk(v) {
  state.askVideo = v;
  $('ask-video').textContent = `Video: ${v.title}`;
  $('ask-message').value = '';
  $('ask-error').textContent = '';
  $('ask-dialog').showModal();
  $('ask-message').focus();
}

$('ask-cancel').addEventListener('click', () => $('ask-dialog').close());

$('ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = state.askVideo;
  const message = $('ask-message').value.trim();
  if (!v) return;
  if (!message) {
    $('ask-error').textContent = 'Napište prosím, co vám nebylo jasné.';
    $('ask-message').focus();
    return;
  }
  $('ask-send').disabled = true;
  try {
    await api('POST', `${API}/${encodeURIComponent(v.id)}/feedback`, { message });
    v.asked = true;
    $('ask-dialog').close();
    toast('Děkujeme, váš dotaz jsme uložili.');
    state.focus = `[data-vid="${v.id}"] .mat-ask`;
    render();
  } catch (err) {
    $('ask-error').textContent = err.message;
  } finally {
    $('ask-send').disabled = false;
  }
});

/* ---------- filtr a start ---------- */

$('filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  render();
});

run(async () => {
  state.data = await api('GET', API);
});