import { Router } from 'express';
import { TestItem } from '../models/TestItem.js';

const router = Router();

// GET /api/test
router.get('/', async (req, res) => {
  const items = await TestItem.find().sort({ createdAt: -1 }).limit(50).lean();
  res.json(items);
});

export default router;