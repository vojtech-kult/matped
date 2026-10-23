import mongoose from 'mongoose';

// Docházka a platba jednoho studenta u jedné lekce.
// Vzniká až při prvním zápisu adminem.
const lessonRecordSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    lecturer: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    hour: { type: Number, required: true, min: 8, max: 20 },
    attended: { type: Boolean, default: null }, // null = nezapsáno
    paid: { type: Boolean, default: false },
  },
  { timestamps: true }
);

lessonRecordSchema.index({ student: 1, lecturer: 1, date: 1, hour: 1 }, { unique: true });

export const LessonRecord = mongoose.model('LessonRecord', lessonRecordSchema, 'lesson_records');