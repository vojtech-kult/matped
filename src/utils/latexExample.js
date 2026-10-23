export const MAX_CODE_LENGTH = 10000;

// Příkazy, které v příkladech nemají co dělat (čtení a zápis souborů, shell, změna znaků, balíčky).
// Seznam je jen první vrstva ochrany, hlavní je zabezpečená kompilace (viz pdf.js).
const FORBIDDEN = [
  /\^\^/, // zápis znaků přes ^^xx (obcházení zákazů)
  /\\(?:input|include|includeonly|openin|openout|read|readline|write|newread|newwrite|immediate|catcode|csname|endcsname|scantokens|everyeof|special|verb|verbatiminput|lstinputlisting|includegraphics|usepackage|RequirePackage|documentclass|makeatletter|makeatother|InputIfFileExists|IfFileExists)(?![a-zA-Z])/,
  /\\pdf[a-zA-Z]+/,
  /\\@/,
  /\\(?:begin|end)\{(?:verbatim\*?|Verbatim|lstlisting|minted|filecontents\*?)\}/,
];

const ENV_RE = /\\(begin|end)\{([^}]*)\}/g;

const fail = (error) => ({ ok: false, error });

export const normalizeCode = (code) => code.replace(/\r\n?/g, '\n').trim();
export const normalizeIntro = (s) => s.replace(/\s+/g, ' ').trim();

// Odstraní komentáře (% ... do konce řádku), kromě \%
const stripComments = (text) => text.replace(/(^|[^\\])%.*$/gm, '$1');

// Kontrola závorek { }, dolarů a párování \begin / \end. Vrací text chyby, nebo null.
function checkStructure(text, where) {
  const clean = stripComments(text);

  let depth = 0;
  let dollars = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '\\') {
      i++; // přeskočí znak za zpětným lomítkem (\\, \$, \{ ...)
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return `${where}: přebývá uzavírací závorka }`;
    } else if (ch === '$') dollars++;
  }
  if (depth > 0) return `${where}: chybí uzavírací závorka }`;
  if (dollars % 2) return `${where}: lichý počet znaků $ (nespárovaná matematika)`;

  const stack = [];
  for (const m of clean.matchAll(ENV_RE)) {
    if (m[1] === 'begin') stack.push(m[2]);
    else if (stack.pop() !== m[2]) return `${where}: nesedí \\begin a \\end u prostředí ${m[2]}`;
  }
  if (stack.length) return `${where}: chybí \\end{${stack.at(-1)}}`;
  return null;
}

function markerLines(lines, name) {
  const re = new RegExp(`^\\s*%\\s*${name}\\s*$`);
  return lines.flatMap((line, i) => (re.test(line) ? [i] : []));
}

// Společné zadání = text před první display rovnicí ($$, \[ nebo \begin{...})
function splitIntro(zadani) {
  const m = /\$\$|\\\[|\\begin\{/.exec(zadani);
  if (!m || m.index === 0) return { intro: '', body: zadani };

  const intro = zadani.slice(0, m.index).trim();
  if (!intro || checkStructure(intro, 'úvod')) return { intro: '', body: zadani };
  return { intro, body: zadani.slice(m.index).trim() };
}

// Vrací { ok: true, zadani, reseni, intro, body } nebo { ok: false, error }
export function parseExample(rawCode) {
  if (typeof rawCode !== 'string') return fail('Kód musí být text');
  const code = normalizeCode(rawCode);
  if (!code) return fail('Kód je prázdný');
  if (code.length > MAX_CODE_LENGTH) return fail(`Kód je příliš dlouhý (max. ${MAX_CODE_LENGTH} znaků)`);
  if (code.includes('\0')) return fail('Kód obsahuje nepovolený znak');

  for (const re of FORBIDDEN) {
    const m = re.exec(code);
    if (m) return fail(`Kód obsahuje nepovolený příkaz: ${m[0]}`);
  }

  const lines = code.split('\n');
  const pos = {};
  for (const name of ['ZADANI_START', 'ZADANI_END', 'RESENI_START', 'RESENI_END']) {
    const found = markerLines(lines, name);
    if (found.length === 0) return fail(`Chybí značka % ${name}`);
    if (found.length > 1) return fail(`Značka % ${name} je v kódu víckrát`);
    pos[name] = found[0];
  }
  if (!(pos.ZADANI_START < pos.ZADANI_END && pos.ZADANI_END < pos.RESENI_START && pos.RESENI_START < pos.RESENI_END)) {
    return fail('Značky musí jít za sebou: ZADANI_START, ZADANI_END, RESENI_START, RESENI_END');
  }

  const before = lines.slice(0, pos.ZADANI_START).join('\n').trim();
  const between = lines.slice(pos.ZADANI_END + 1, pos.RESENI_START).join('\n').trim();
  const after = lines.slice(pos.RESENI_END + 1).join('\n').trim();
  if (before !== '\\begin{priklad}') return fail('Před % ZADANI_START musí být jen \\begin{priklad}');
  if (between) return fail('Mezi % ZADANI_END a % RESENI_START nesmí být žádný obsah');
  if (after !== '\\end{priklad}') return fail('Za % RESENI_END musí být jen \\end{priklad}');

  const zadani = lines.slice(pos.ZADANI_START + 1, pos.ZADANI_END).join('\n').trim();
  const reseni = lines.slice(pos.RESENI_START + 1, pos.RESENI_END).join('\n').trim();
  if (!zadani) return fail('Zadání je prázdné');
  if (!reseni) return fail('Řešení je prázdné');
  if (/\\(?:begin|end)\{(?:priklad|reseni)\}/.test(zadani)) {
    return fail('Zadání nesmí obsahovat prostředí priklad ani reseni');
  }
  if (!reseni.startsWith('\\begin{reseni}') || !reseni.endsWith('\\end{reseni}')) {
    return fail('Řešení musí být celé v prostředí reseni (\\begin{reseni} … \\end{reseni})');
  }

  const zadaniError = checkStructure(zadani, 'Zadání');
  if (zadaniError) return fail(zadaniError);
  const reseniError = checkStructure(reseni, 'Řešení');
  if (reseniError) return fail(reseniError);

  return { ok: true, zadani, reseni, ...splitIntro(zadani) };
}

// Příklady se stejným úvodem se sloučí do jedné skupiny (skupina je na místě prvního výskytu)
export function buildGroups(parsedList) {
  const groups = [];
  const byIntro = new Map();

  for (const p of parsedList) {
    const key = p.intro ? normalizeIntro(p.intro) : null;
    if (key && byIntro.has(key)) {
      byIntro.get(key).items.push(p);
      continue;
    }
    const group = { intro: p.intro, items: [p] };
    groups.push(group);
    if (key) byIntro.set(key, group);
  }
  return groups;
}