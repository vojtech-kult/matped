import mongoose from 'mongoose';

// Postup jednoho studenta (jeden dokument na studenta)
const progressSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
    sections: { type: [String], default: undefined }, // ID splněných podúkolů
    tests: { type: [Number], default: undefined }, // čísla levelů s napsaným testem
  },
  { timestamps: true }
);

export const Progress = mongoose.model('Progress', progressSchema, 'progress');