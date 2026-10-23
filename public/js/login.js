const form = document.getElementById('login-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = '';
  try {
    const res = await fetch(form.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      window.location.href = data.redirect;
      return;
    }
    message.textContent = data.error ?? 'Přihlášení se nezdařilo';
  } catch {
    message.textContent = 'Chyba spojení se serverem';
  }
});