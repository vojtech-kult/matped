import mongoose from 'mongoose';

// Dotaz studenta k videu („co mi nebylo jasné“). Údaje o studentovi a videu se ukládají jako
// kopie, aby zpráva zůstala čitelná, i když se video nebo jméno později změní.
const videoFeedbackSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentNumber: { type: String, required: true },
    studentName: { type: String, required: true },
    curriculum: { type: String, required: true },
    videoId: { type: String, required: true },
    videoTitle: { type: String, required: true },
    videoUrl: { type: String, required: true },
    sectionId: { type: String, required: true },
    sectionTitle: { type: String, required: true },
    level: { type: Number, required: true },
    levelTitle: { type: String, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    discordSent: { type: Boolean, default: false }, // false = na Discord se nepodařilo odeslat
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
videoFeedbackSchema.index({ createdAt: -1 });
videoFeedbackSchema.index({ student: 1, videoId: 1 });

export const VideoFeedback = mongoose.model('VideoFeedback', videoFeedbackSchema);