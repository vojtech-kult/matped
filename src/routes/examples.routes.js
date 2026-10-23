import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { Example } from '../models/Example.js';
import { requireRole } from '../middleware/auth.js';
import { EXAMPLE_LABELS, MIN_DIFFICULTY, MAX_DIFFICULTY, MAX_PDF_EXAMPLES } from '../config/examples.js';
import { parseExample, normalizeCode, buildGroups } from '../utils/latexExample.js';
import { generatePdf, PdfError } from '../utils/pdf.js';

const router = Router();
router.use(requireRole('admin'));

const ID_RE = /^[a-f\d]{24}$/i;
const MAX_LIST = 500;
const isDifficulty = (v) => Number.isInteger(v) && v >= MIN_DIFFICULTY && v <= MAX_DIFFICULTY;

function parseDifficultyQuery(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = typeof value === 'string' ? Number(value) : NaN;
  return isDifficulty(n) ? n : null;
}

const pdfLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Příliš mnoho generování PDF, zkuste to za chvíli.' },
});

// Kategorie a počty příkladů v nich
router.get('/config', async (req, res) => {
  const rows = await Example.aggregate([{ $group: { _id: '$label', count: { $sum: 1 } } }]);
  res.json({
    labels: EXAMPLE_LABELS,
    counts: Object.fromEntries(rows.map((r) => [r._id, r.count])),
    minDifficulty: MIN_DIFFICULTY,
    maxDifficulty: MAX_DIFFICULTY,
    maxPdf: MAX_PDF_EXAMPLES,
  });
});

// Seznam příkladů jedné kategorie
router.get('/', async (req, res) => {
  const { label, sort } = req.query;
  if (typeof label !== 'string' || !EXAMPLE_LABELS.includes(label)) {
    return res.status(400).json({ error: 'Neznámá kategorie' });
  }
  const min = parseDifficultyQuery(req.query.min, MIN_DIFFICULTY);
  const max = parseDifficultyQuery(req.query.max, MAX_DIFFICULTY);
  if (min === null || max === null || min > max) {
    return res.status(400).json({ error: `Obtížnost musí být celé číslo ${MIN_DIFFICULTY} až ${MAX_DIFFICULTY}` });
  }

  const docs = await Example.find({ label, difficulty: { $gte: min, $lte: max } })
    .sort({ difficulty: sort === 'desc' ? -1 : 1, _id: 1 })
    .limit(MAX_LIST)
    .lean();

  res.json({
    items: docs.map((d) => {
      const p = parseExample(d.code);
      return {
        id: String(d._id),
        label: d.label,
        difficulty: d.difficulty,
        code: d.code,
        zadani: p.ok ? p.zadani : null,
        error: p.ok ? null : p.error,
      };
    }),
    truncated: docs.length === MAX_LIST,
  });
});

// Přidání příkladu
router.post('/', async (req, res) => {
  const { code, label, difficulty } = req.body ?? {};
  if (typeof label !== 'string' || !EXAMPLE_LABELS.includes(label)) {
    return res.status(400).json({ error: 'Vyberte kategorii ze seznamu' });
  }
  if (!isDifficulty(difficulty)) {
    return res.status(400).json({ error: `Obtížnost musí být celé číslo ${MIN_DIFFICULTY} až ${MAX_DIFFICULTY}` });
  }
  const parsed = parseExample(code);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const normalized = normalizeCode(code);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');

  try {
    const doc = await Example.create({ code: normalized, hash, label, difficulty });
    res.status(201).json({ ok: true, id: doc.id });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Tento příklad už v databázi je' });
    throw err;
  }
});

// Smazání příkladu
router.delete('/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Neplatné ID' });
  const deleted = await Example.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Příklad nenalezen' });
  res.json({ ok: true });
});

// Dvě PDF: jen zadání, a zadání s řešením
router.post('/pdf', pdfLimiter, async (req, res) => {
  const { ids } = req.body ?? {};
  const title =
    typeof req.body?.title === 'string' ? req.body.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '';

  if (
    !Array.isArray(ids) || !ids.length || ids.length > MAX_PDF_EXAMPLES ||
    !ids.every((id) => typeof id === 'string' && ID_RE.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return res.status(400).json({ error: `Vyberte 1 až ${MAX_PDF_EXAMPLES} příkladů` });
  }

  const docs = await Example.find({ _id: { $in: ids } }).select('code').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const parsed = [];
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) return res.status(409).json({ error: 'Některý z příkladů už neexistuje, obnovte seznam' });
    const p = parseExample(doc.code); // kód se kontroluje znovu i při generování
    if (!p.ok) return res.status(422).json({ error: `Příklad ${id} je neplatný: ${p.error}` });
    parsed.push(p);
  }

  const groups = buildGroups(parsed);
  try {
    const zadani = await generatePdf(groups, { title, withSolution: false });
    const reseni = await generatePdf(groups, { title, withSolution: true });
    res.json({
      files: [
        { name: 'zadani.pdf', label: 'Zadání', data: zadani.toString('base64') },
        { name: 'zadani-s-resenim.pdf', label: 'Zadání s řešením', data: reseni.toString('base64') },
      ],
    });
  } catch (err) {
    if (err instanceof PdfError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export default router;