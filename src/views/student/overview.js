const $ = (id) => document.getElementById(id);

const STATUS_TEXT = { completed: 'splněno', current: 'aktuální', upcoming: 'čeká' };
const STATUS_ICON = { completed: '✓', current: '▶', upcoming: '○' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(url) {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/student-login.html';
    throw new Error('Nepřihlášen');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Chyba');
  return data;
}

function showError(text) {
  let box = $('toast');
  if (!box) {
    box = el('div', 'toast error');
    box.id = 'toast';
    box.setAttribute('role', 'alert');
    document.body.append(box);
  }
  box.textContent = text;
}

function renderMe(me) {
  $('s-name').textContent = me.name || '—';
  $('s-number').textContent = me.studentNumber;
  $('s-credits').textContent = String(me.credits);
}

function renderHero(data) {
  const { levels, courseCompleted, currentLevel, xp, maxXp } = data;
  const level = courseCompleted ? levels[levels.length - 1] : levels.find((l) => l.level === currentLevel);
  const percent = courseCompleted ? 100 : level.percent;

  $('badge').textContent = courseCompleted ? '★' : level.level;
  $('level-no').textContent = courseCompleted ? 'Kurz dokončen' : `Level ${level.level} z ${levels.length}`;
  $('level-title').textContent = level.title;
  if (data.label) $('level-no').textContent += ` · ${data.label}`;
  $('bar-fill').style.width = `${percent}%`;
  $('bar').setAttribute('aria-valuenow', String(percent));
  $('xp').textContent = `${xp} / ${maxXp} XP`;

  if (courseCompleted) {
    $('bar-text').textContent = 'Všechny úrovně jsou splněné.';
    $('hint').textContent = '';
    return;
  }
  $('bar-text').textContent = `${level.doneCount} z ${level.total} podúkolů splněno (${level.percent} %)`;
  $('hint').textContent =
    level.doneCount === level.total
      ? 'Všechny podúkoly jsou splněné. Zbývá závěrečný test úrovně.'
      : 'Po splnění všech podúkolů následuje závěrečný test úrovně.';
}

function levelElement(l) {
  const details = el('details', `level ${l.status}`);
  details.open = l.status === 'current';

  const summary = el('summary', '', `${STATUS_ICON[l.status]} Level ${l.level}: ${l.title} `);
  summary.append(el('span', 'status', `(${STATUS_TEXT[l.status]}, ${l.percent} %)`));
  const bar = el('div', 'xpbar small');
  const fill = el('div');
  fill.style.width = `${l.percent}%`;
  bar.append(fill);
  summary.append(bar);
  details.append(summary);

  const list = el('ul', 'sections');
  for (const s of l.sections) list.append(el('li', s.done ? 'done' : 'todo', `${s.done ? '✓' : '○'} ${s.title}`));
  list.append(el('li', `test ${l.testPassed ? 'done' : 'todo'}`, `${l.testPassed ? '✓' : '○'} Závěrečný test úrovně`));
  details.append(list);
  return details;
}

Promise.all([api('/api/student/me'), api('/api/student/progress')])
  .then(([me, progress]) => {
    renderMe(me);
    if (progress.enabled === false) {
      // vlastní kurikulum: level systém není aktivní
      $('progress-card').hidden = true;
      $('levels-card').hidden = true;
      $('no-levels').hidden = false;
      return;
    }
    renderHero(progress);
    $('levels').replaceChildren(...progress.levels.map(levelElement));
  })
  .catch((err) => showError(err.message));