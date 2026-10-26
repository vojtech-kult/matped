// Menu veřejného webu na úzkých obrazovkách: do lišty doplní tlačítko a odkazy rozbalí pod ní.
// Na počítači (≥ 48 rem) tlačítko skryje CSS a nic se nemění. Markup navbaru se upravovat nemusí.
const initSiteNav = () => {
  const bar = document.querySelector('.navbar');
  const links = bar?.querySelector('.navbar-links');
  if (!bar || !links || bar.querySelector('.navbar-toggle')) return;

  links.id ||= 'navbar-links';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'navbar-toggle';
  button.setAttribute('aria-controls', links.id);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Menu');
  const bars = document.createElement('span');
  bars.className = 'navbar-toggle-bars';
  bars.setAttribute('aria-hidden', 'true');
  button.append(bars);
  bar.append(button);

  const set = (open) => {
    bar.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Zavřít menu' : 'Menu');
  };

  button.addEventListener('click', () => set(!bar.classList.contains('is-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); }); // odkazy na kotvy stránku nenačtou znovu
  document.addEventListener('click', (e) => { if (!bar.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bar.classList.contains('is-open')) {
      set(false);
      button.focus();
    }
  });
  window.matchMedia('(min-width: 48.01rem)').addEventListener('change', () => set(false));
  window.addEventListener('pageshow', () => set(false));
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSiteNav);
else initSiteNav();