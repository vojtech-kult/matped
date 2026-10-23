// Společné odhlášení: tlačítko s data-logout="/kam-presmerovat"
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-logout]');
  if (!btn) return;

  btn.disabled = true;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } finally {
    window.location.href = btn.dataset.logout;
  }
});