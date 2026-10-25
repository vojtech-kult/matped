import mongoose from 'mongoose';

// Postup studenta u jednoho videa: zhlédnuto + zda tématu rozumí
const videoProgressSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    videoId: { type: String, required: true },
    watched: { type: Boolean, default: false },
    understood: { type: String, enum: ['yes', 'no'], default: null }, // yes = chápu, no = potřebuji dovysvětlit
  },
  { timestamps: true }
);
videoProgressSchema.index({ student: 1, videoId: 1 }, { unique: true });

export const VideoProgress = mongoose.model('VideoProgress', videoProgressSchema);