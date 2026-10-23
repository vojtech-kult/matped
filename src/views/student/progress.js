const $ = (id) => document.getElementById(id);
const message = $('message');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STATUS_TEXT = { completed: 'splněno', current: 'aktuální', upcoming: 'čeká' };
const STATUS_ICON = { completed: '✓', current: '▶', upcoming: '○' };

function renderHero(data) {
  const { levels, courseCompleted, currentLevel, xp, maxXp } = data;
  const level = courseCompleted ? levels[levels.length - 1] : levels.find((l) => l.level === currentLevel);
  const percent = courseCompleted ? 100 : level.percent;

  $('badge').textContent = courseCompleted ? '★' : level.level;
  $('level-no').textContent = courseCompleted ? 'Kurz dokončen' : `Level ${level.level} z ${levels.length}`;
  $('level-title').textContent = level.title;
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
  for (const s of l.sections) {
    list.append(el('li', s.done ? 'done' : 'todo', `${s.done ? '✓' : '○'} ${s.title}`));
  }
  list.append(
    el('li', `test ${l.testPassed ? 'done' : 'todo'}`, `${l.testPassed ? '✓' : '○'} Závěrečný test úrovně`)
  );
  details.append(list);
  return details;
}

async function load() {
  const res = await fetch('/api/student/progress');
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/student-login.html';
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Chyba');

  renderHero(data);
  $('levels').replaceChildren(...data.levels.map(levelElement));
}

load().catch((err) => {
  message.textContent = err.message;
  message.style.color = 'crimson';
});