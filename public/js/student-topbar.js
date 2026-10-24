// Doplní do horní lišty jméno a číslo přihlášeného studenta
(async () => {
  const box = document.getElementById('who');
  if (!box) return;
  try {
    const res = await fetch('/api/student/me');
    if (!res.ok) return;
    const me = await res.json();
    const name = document.createElement('strong');
    name.textContent = me.name || 'Student';
    const number = document.createElement('span');
    number.textContent = `#${me.studentNumber}`;
    box.replaceChildren(name, number);
    box.hidden = false;
  } catch {
    /* lišta funguje i bez jména */
  }
})();