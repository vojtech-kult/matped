import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.join(import.meta.dirname, '..', 'components');
const isProd = process.env.NODE_ENV === 'production';
const cache = new Map();

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Název komponenty je omezený regulárním výrazem níže ([A-Z][A-Za-z0-9]*), takže nejde vyskočit ze složky
function loadComponent(name) {
  if (isProd && cache.has(name)) return cache.get(name);
  let html = null;
  try {
    html = fs.readFileSync(path.join(COMPONENTS_DIR, `${name}.html`), 'utf8');
  } catch {
    html = null;
  }
  if (isProd) cache.set(name, html); // v produkci se čte jednou, při vývoji pokaždé (změny hned vidět)
  return html;
}

// <Nazev atribut="hodnota" />   (jen samozavřené značky začínající velkým písmenem)
const TAG_RE = /<([A-Z][A-Za-z0-9]*)((?:\s+[a-zA-Z][\w-]*="[^"]*")*)\s*\/>/g;
const ATTR_RE = /([a-zA-Z][\w-]*)="([^"]*)"/g;

export function renderComponents(html, depth = 0) {
  if (depth > 5) throw new Error('Příliš hluboké vnořování komponent');

  return html.replace(TAG_RE, (match, name, attrString) => {
    const template = loadComponent(name);
    if (template === null) {
      console.warn(`Komponenta <${name} /> nenalezena v src/components/`);
      return `<!-- Komponenta ${name} nenalezena -->`;
    }

    const props = {};
    for (const m of attrString.matchAll(ATTR_RE)) props[m[1]] = m[2];

    // {{ nazev }} v komponentě se nahradí (escapovanou) hodnotou atributu
    let out = template.replace(/\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g, (_, key) => escapeHtml(props[key] ?? ''));

    // active="rozvrh": odkaz s data-nav="rozvrh" dostane aria-current="page"
    if (props.active) {
      const needle = `data-nav="${escapeHtml(props.active)}"`;
      out = out.replaceAll(needle, () => `${needle} aria-current="page"`);
    }
    return renderComponents(out, depth + 1);
  });
}

// Middleware: .html soubory ze složky projde rendererem, ostatní (js, css) nechá na express.static
export function servePages(dir) {
  const root = path.resolve(dir);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // /admin -> /admin/ (stejně jako dřív express.static, jinak by relativní cesty k js nefungovaly)
    if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) {
      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(301, `${req.baseUrl}/${query}`);
    }

    let urlPath;
    try {
      urlPath = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    if (!urlPath.endsWith('.html')) return next();

    const file = path.resolve(root, `.${urlPath}`);
    if (!file.startsWith(root + path.sep)) return next();

    fs.readFile(file, 'utf8', (err, html) => {
      if (err) return next();
      res.type('html').send(renderComponents(html));
    });
  };
}