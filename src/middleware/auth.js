// Pro API: vrací JSON chybu
export function requireRole(role) {
  return (req, res, next) => {
    const { userId, role: current } = req.session ?? {};
    if (userId && current === role) return next();
    res
      .status(userId ? 403 : 401)
      .json({ error: userId ? 'Nedostatečná oprávnění' : 'Nepřihlášen' });
  };
}

// Pro stránky: přesměruje na přihlášení
export function requireRolePage(role, redirectTo) {
  return (req, res, next) => {
    const { userId, role: current } = req.session ?? {};
    if (userId && current === role) {
      res.set('Cache-Control', 'no-store');
      return next();
    }
    res.redirect(redirectTo);
  };
}

// Dodatečná ochrana proti CSRF: změny dat přijímáme jen jako JSON.
// Cizí web nemůže poslat application/json bez CORS preflightu (který nepovolujeme).
export function requireJson(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('Content-Type')?.startsWith('application/json')) return next();
  res.status(415).json({ error: 'Očekává se application/json' });
}