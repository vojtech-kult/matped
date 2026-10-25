import { Router } from 'express';
import mongoose from 'mongoose';
import { Student } from '../models/Student.js';
import { VideoProgress } from '../models/VideoProgress.js';
import { VideoFeedback } from '../models/VideoFeedback.js';
import { TRACKS, CURRICULUM_LABELS } from '../config/tracks.js';
import { curriculumOf } from '../utils/progress.js';
import { findVideo } from '../utils/curriculumStore.js';
import { sendDiscordPayload, escapeMd, clip } from '../utils/discord.js';

// Připojuje se v student.routes.js (za requireRole('student')): router.use('/materials', materialsRoutes);
const router = Router();

const ID_RE = /^[\w.-]{1,60}$/;
const MAX_FEEDBACK_PER_HOUR = 10;

const studentId = (req) => new mongoose.Types.ObjectId(req.session.userId);

// Přehled videí kurikula, které má student nastavené, spolu s jeho postupem
router.get('/', async (req, res) => {
  const id = studentId(req);
  const student = await Student.findById(id).select('curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });

  const curriculum = curriculumOf(student);
  const base = { curriculum, label: CURRICULUM_LABELS[curriculum] ?? curriculum };
  const track = TRACKS[curriculum];
  if (!track) return res.json({ ...base, enabled: false, levels: [], total: 0, watched: 0, understood: 0 });

  const [progress, asked] = await Promise.all([
    VideoProgress.find({ student: id }).select('videoId watched understood').lean(),
    VideoFeedback.distinct('videoId', { student: id }),
  ]);
  const byVideo = new Map(progress.map((p) => [p.videoId, p]));
  const askedSet = new Set(asked);

  let total = 0;
  let watched = 0;
  let understood = 0;
  const levels = track.levels
    .map((l) => ({
      level: l.level,
      title: l.title,
      sections: l.sections
        .filter((s) => s.videos?.length)
        .map((s) => ({
          id: s.id,
          title: s.title,
          videos: s.videos.map((v) => {
            const p = byVideo.get(v.id);
            const isWatched = p?.watched === true;
            total += 1;
            if (isWatched) watched += 1;
            if (isWatched && p.understood === 'yes') understood += 1;
            return {
              id: v.id,
              title: v.title,
              url: v.url,
              watched: isWatched,
              understood: isWatched ? p.understood ?? null : null,
              asked: askedSet.has(v.id),
            };
          }),
        })),
    }))
    .filter((l) => l.sections.length);

  res.json({ ...base, enabled: true, levels, total, watched, understood });
});

// Zhlédnuto / „chápu“ / „potřebuji dovysvětlit“
router.put('/:videoId/progress', async (req, res) => {
  const { videoId } = req.params;
  if (!ID_RE.test(videoId)) return res.status(400).json({ error: 'Neplatné video' });
  const { watched, understood } = req.body ?? {};

  const set = {};
  if (watched !== undefined) {
    if (typeof watched !== 'boolean') return res.status(400).json({ error: 'Neplatná hodnota' });
    set.watched = watched;
  }
  if (understood !== undefined) {
    if (understood !== null && understood !== 'yes' && understood !== 'no') return res.status(400).json({ error: 'Neplatná hodnota' });
    set.understood = understood;
  }
  if (!Object.keys(set).length) return res.status(400).json({ error: 'Nic k uložení' });
  if (watched === false) set.understood = null; // bez zhlédnutí nemá hodnocení smysl

  const id = studentId(req);
  const student = await Student.findById(id).select('curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });
  if (!findVideo(curriculumOf(student), videoId)) return res.status(404).json({ error: 'Video nenalezeno' });

  // hodnotit lze jen zhlédnuté video: pokud se zhlédnutí neposílá, musí už být uložené
  const needsWatched = set.understood != null && watched !== true;
  const filter = { student: id, videoId };
  if (needsWatched) filter.watched = true;

  const write = () => VideoProgress.updateOne(filter, { $set: set }, { upsert: !needsWatched });
  let result;
  try {
    result = await write();
  } catch (err) {
    if (err.code !== 11000) throw err;
    result = await write(); // souběh dvou prvních zápisů
  }
  if (needsWatched && !result.matchedCount) return res.status(400).json({ error: 'Nejdřív označte video jako zhlédnuté' });
  res.json({ ok: true });
});

// Zpráva „co mi nebylo jasné“
router.post('/:videoId/feedback', async (req, res) => {
  const { videoId } = req.params;
  if (!ID_RE.test(videoId)) return res.status(400).json({ error: 'Neplatné video' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 1 || message.length > 1000) {
    return res.status(400).json({ error: 'Zpráva musí mít 1 až 1000 znaků' });
  }

  const id = studentId(req);
  const student = await Student.findById(id).select('studentNumber name curriculum').lean();
  if (!student) return res.status(404).json({ error: 'Student nenalezen' });
  const curriculum = curriculumOf(student);
  const found = findVideo(curriculum, videoId);
  if (!found) return res.status(404).json({ error: 'Video nenalezeno' });

  const recent = await VideoFeedback.countDocuments({ student: id, createdAt: { $gte: new Date(Date.now() - 3600_000) } });
  if (recent >= MAX_FEEDBACK_PER_HOUR) {
    return res.status(429).json({ error: 'Odeslali jste příliš mnoho zpráv, zkuste to později' });
  }

  const feedback = await VideoFeedback.create({
    student: id,
    studentNumber: student.studentNumber,
    studentName: student.name,
    curriculum,
    videoId,
    videoTitle: found.video.title,
    videoUrl: found.video.url,
    sectionId: found.section.id,
    sectionTitle: found.section.title,
    level: found.level.level,
    levelTitle: found.level.title,
    message,
  });

  // Dotaz jde i na Discord; zpráva je už v databázi, takže výpadek Discordu studentovi neuškodí
  let sent = false;
  try {
    await sendDiscordPayload({
      embeds: [
        {
          title: 'Dotaz',
          color: 0x5865f2,
          description: clip(message, 1000),
          fields: [
            { name: 'Student', value: clip(`${escapeMd(student.name)} (${student.studentNumber})`, 1000) },
            { name: 'Video', value: clip(`[${escapeMd(found.video.title)}](${found.video.url})`, 1000) },
            { name: 'Téma', value: clip(`Level ${found.level.level}: ${escapeMd(found.level.title)}\n${escapeMd(found.section.title)}`, 1000) },
            { name: 'Kurikulum', value: CURRICULUM_LABELS[curriculum] ?? curriculum, inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    sent = true;
  } catch (err) {
    console.error('Discord (dotaz k videu):', err.message);
  }
  if (sent) await VideoFeedback.updateOne({ _id: feedback._id }, { $set: { discordSent: true } });

  res.status(201).json({ ok: true });
});

export default router;