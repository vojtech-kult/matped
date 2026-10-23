import mongoose from 'mongoose';

// Evidence odeslaných denních přehledů (brání dvojímu odeslání)
const dailyReportSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    sent: { type: Number }, // kolik zpráv už bylo odesláno
    done: { type: Boolean },
    lockedUntil: { type: Date }, // dočasný zámek, kdo právě odesílá
    sentAt: { type: Date },
  },
  { timestamps: true }
);

// Záznamy se po 90 dnech samy smažou
dailyReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const DailyReport = mongoose.model('DailyReport', dailyReportSchema, 'daily_reports');