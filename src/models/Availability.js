import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema(
  {
    lecturer: { type: String, required: true },
    year: { type: Number, required: true },
    day: { type: Number, required: true, min: 1, max: 7 },
    hour: { type: Number, required: true, min: 8, max: 20 },
    week: { type: Number, default: null, min: 1, max: 53 },
    excludedWeeks: { type: [Number], default: [] },
  },
  { timestamps: true }
);

// Jedno políčko = jeden dokument (pravidelné má week: null)
availabilitySchema.index(
  { lecturer: 1, year: 1, day: 1, hour: 1, week: 1 },
  { unique: true }
);

export const Availability = mongoose.model('Availability', availabilitySchema, 'availability');