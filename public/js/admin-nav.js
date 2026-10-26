// Výsuvné menu administrace na úzkých obrazovkách (≤ 56rem); na počítači nic nedělá.
const initNav = () => {
  const button = document.getElementById('nav-toggle');
  const sidebar = document.getElementById('app-sidebar');
  if (!button || !sidebar) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'nav-backdrop';
  sidebar.after(backdrop);

  const wide = window.matchMedia('(min-width: 56.01rem)');
  const set = (open) => {
    document.body.classList.toggle('nav-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Zavřít menu' : 'Menu');
  };

  button.addEventListener('click', () => set(!document.body.classList.contains('nav-open')));
  backdrop.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
      set(false);
      button.focus();
    }
  });
  wide.addEventListener('change', () => set(false));
  window.addEventListener('pageshow', () => set(false)); // návrat tlačítkem Zpět
};

// skript je v horní liště, tedy dřív než boční lišta – počkáme na dokončení načtení stránky
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNav);
else initNav();

// Popisky sloupců tabulek pro mobilní zobrazení (řádek se tam zobrazí jako karta).
// Stránky plní tabulky skriptem, proto sledujeme změny a popisky doplňujeme průběžně.
const labelTables = () => {
  for (const table of document.querySelectorAll('table.tbl')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, i) => {
        if (heads[i] && cell.dataset.label !== heads[i]) cell.dataset.label = heads[i];
      });
    }
  }
};
let labelQueued = false;
const queueLabels = () => {
  if (labelQueued) return;
  labelQueued = true;
  requestAnimationFrame(() => {
    labelQueued = false;
    labelTables();
  });
};
const startLabels = () => {
  labelTables();
  new MutationObserver(queueLabels).observe(document.body, { childList: true, subtree: true });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLabels);
else startLabels();