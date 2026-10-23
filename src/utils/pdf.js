import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const LATEX_BIN = process.env.LATEX_BIN || 'pdflatex';
const TEMPLATE_PATH = path.join(import.meta.dirname, '..', 'latex', 'template.tex');
const TIMEOUT_MS = 60_000;

export class PdfError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const LATEX_ESCAPES = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&',
  '#': '\\#', '^': '\\textasciicircum{}', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}',
};
export const escapeLatex = (s) => s.replace(/[\\{}$&#^_%~]/g, (c) => LATEX_ESCAPES[c]);

// Přeskládá skupiny příkladů do LaTeXu
function renderContent(groups, withSolution) {
  const out = [];
  for (const group of groups) {
    const grouped = Boolean(group.intro) && group.items.length > 1;
    if (grouped) out.push(`\\begin{skupina}\n${group.intro}\n\\end{skupina}`);

    for (const item of group.items) {
      const text = grouped ? item.body : item.zadani; // společný úvod se vypíše jen jednou
      out.push(`\\begin{priklad}\n${text}${withSolution ? `\n${item.reseni}` : ''}\n\\end{priklad}`);
    }
  }
  return out.join('\n\n');
}

// Kompilace běží s minimálním prostředím: žádné tajné proměnné serveru (Mongo URI, session secret...)
const ENV_ALLOW = new Set([
  'path', 'systemroot', 'windir', 'comspec', 'pathext',
  'appdata', 'localappdata', 'userprofile', 'programdata', 'programfiles', 'programfiles(x86)', 'programw6432',
]);

function childEnv(dir) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_ALLOW.has(key.toLowerCase())) env[key] = value;
  }
  return {
    ...env,
    HOME: dir, TEMP: dir, TMP: dir, TMPDIR: dir, TEXMFOUTPUT: dir,
    openin_any: 'p', // paranoid: žádné čtení souborů mimo pracovní složku
    openout_any: 'p',
    shell_escape: 'f',
  };
}

function summarizeLog(log) {
  const lines = log.split('\n');
  const i = lines.findIndex((l) => l.startsWith('!'));
  if (i === -1) return '';
  return lines.slice(i, i + 4).join(' ').replace(/\s+/g, ' ').slice(0, 400);
}

async function compilePdf(tex) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'matped-tex-'));
  try {
    await writeFile(path.join(dir, 'main.tex'), tex, 'utf8');
    try {
      await execFileAsync(
        LATEX_BIN,
        ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'main.tex'],
        {
          cwd: dir,
          env: childEnv(dir),
          timeout: TIMEOUT_MS,
          killSignal: 'SIGKILL',
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
    } catch (err) {
      if (err.code === 'ENOENT') throw new PdfError('Na serveru není nainstalovaný LaTeX (příkaz pdflatex).', 500);
      if (err.killed) throw new PdfError('Generování PDF trvalo příliš dlouho a bylo přerušeno.', 504);
      const log = await readFile(path.join(dir, 'main.log'), 'utf8').catch(() => '');
      console.error('LaTeX selhal:\n', log.slice(-2000));
      throw new PdfError(`Kompilace LaTeXu selhala. ${summarizeLog(log)}`.trim(), 422);
    }
    return await readFile(path.join(dir, 'main.pdf'));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Kompilace je náročná na procesor, proto běží po jedné
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

export async function generatePdf(groups, { title, withSolution }) {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const tex = template
    .replace('%%TITLE%%', () => escapeLatex(title || 'Příklady'))
    .replace('%%SUBTITLE%%', () => (withSolution ? 'Zadání a řešení' : 'Zadání'))
    .replace('%%CONTENT%%', () => renderContent(groups, withSolution)); // obsah se dosazuje jako poslední
  return enqueue(() => compilePdf(tex));
}