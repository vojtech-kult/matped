import mongoose from 'mongoose';

// Jedna konkrétní lekce = lektor + datum + hodina.
// Dokument vzniká při první rezervaci.
const lessonSchema = new mongoose.Schema(
  {
    lecturer: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
    hour: { type: Number, required: true, min: 8, max: 20 },
    // default: undefined je nutné, aby upsert nekolidoval s $push
    students: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }], default: undefined },
    count: { type: Number, min: 0 }, // počet rezervací, podle něj se hlídá kapacita
  },
  { timestamps: true }
);

lessonSchema.index({ lecturer: 1, date: 1, hour: 1 }, { unique: true });
lessonSchema.index({ students: 1 });

export const Lesson = mongoose.model('Lesson', lessonSchema, 'lessons');