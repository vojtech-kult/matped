import { Router } from 'express';
import { Curriculum } from '../models/Curriculum.js';
import { CURRICULUM_LABELS } from '../config/tracks.js';
import { EDITABLE, normalizeLevels, applyLevels, toClient, defaultLevels } from '../utils/curriculumStore.js';

// Připojuje se v admin.routes.js (za requireRole('admin')): router.use('/curricula', curriculumRoutes);
const router = Router();

const known = (req, res, next) =>
  EDITABLE.includes(req.params.key) ? next() : res.status(404).json({ error: 'Neznámé kurikulum' });

router.get('/:key', known, async (req, res) => {
  const { key } = req.params;
  const doc = await Curriculum.findOne({ key }).lean();
  res.json({
    key,
    label: CURRICULUM_LABELS[key],
    version: doc?.version ?? 0, // 0 = zatím nikdy neuloženo, platí výchozí kurikulum
    levels: doc ? toClient(doc.levels) : defaultLevels(key),
  });
});

router.put('/:key', known, async (req, res) => {
  const { key } = req.params;
  const version = req.body?.version;
  if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'Neplatná verze' });

  const { levels, error } = normalizeLevels(key, req.body?.levels);
  if (error) return res.status(400).json({ error });

  let newVersion;
  if (version === 0) {
    try {
      await Curriculum.create({ key, version: 1, levels });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'Kurikulum mezitím někdo změnil, obnovte stránku' });
      throw err;
    }
    newVersion = 1;
  } else {
    const doc = await Curriculum.findOneAndUpdate(
      { key, version },
      { $set: { levels }, $inc: { version: 1 } },
      { new: true }
    ).select('version').lean();
    if (!doc) return res.status(409).json({ error: 'Kurikulum mezitím někdo změnil, obnovte stránku' });
    newVersion = doc.version;
  }

  applyLevels(key, levels); // změna platí hned i pro postup studentů
  res.json({ ok: true, version: newVersion });
});

export default router;