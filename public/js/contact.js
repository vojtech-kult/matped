const TYPES = ['poptavka', 'dotaz', 'hodnoceni'];
const DEFAULT_TYPE = 'poptavka';

function typeFromUrl() {
  const type = new URLSearchParams(location.search).get('formType');
  return TYPES.includes(type) ? type : DEFAULT_TYPE;
}

function show(box, text, isError) {
  box.textContent = text;
  box.style.color = isError ? 'crimson' : 'green';
}

function initContactForm(root) {
  const syncUrl = root.dataset.syncUrl === 'yes'; // jen kontaktní stránka propisuje typ do adresy
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];

  function selectType(type, { updateUrl = syncUrl, focus = false } = {}) {
    for (const tab of tabs) {
      const active = tab.dataset.type === type;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.type !== type;

    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('formType', type);
      history.replaceState(null, '', url);
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectType(tab.dataset.type));
  }

  // Ovládání šipkami (Doleva/Doprava, Home, End), jak je u záložek zvykem
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const index = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    let next = null;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectType(tabs[next].dataset.type, { focus: true });
  });

  for (const form of root.querySelectorAll('form[data-type]')) {
    const message = form.querySelector('.flash');
    const button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      show(message, '', false);

      const data = Object.fromEntries(new FormData(form));
      data.type = form.dataset.type;
      data.consent = form.elements.consent.checked; // checkbox pošleme jako true/false
      if (form.elements.rating) {
        const value = form.elements.rating.value; // '' = nic nevybráno
        data.rating = value ? Number(value) : null;
      }

      button.disabled = true; // proti dvojitému odeslání
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json().catch(() => ({}));

        if (res.ok) {
          form.reset();
          show(message, form.dataset.success, false);
        } else {
          show(message, result.error ?? 'Odeslání se nezdařilo', true);
        }
      } catch {
        show(message, 'Chyba spojení se serverem', true);
      } finally {
        button.disabled = false;
      }
    });
  }

  selectType(typeFromUrl(), { updateUrl: false });
}

const root = document.querySelector('[data-contact-form]');
if (root) initContactForm(root);