import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema(
  {
    // String, ne Number: zachová počáteční nuly (např. 004217)
    studentNumber: { type: String, required: true, unique: true, match: /^\d{6}$/ },
    name: { type: String, trim: true, maxlength: 100, default: '' },
    credits: {
      type: Number, default: 0, min: 0, max: 100000,
      validate: { validator: Number.isInteger, message: 'Kredity musí být celé číslo' },
    },
    passwordHash: { type: String, required: true, select: false },
    curriculum: { type: String, enum: ['prijimacky', 'maturita', 'vlastni'], default: 'prijimacky' },
  },
  { timestamps: true }
);

export const Student = mongoose.model('Student', studentSchema, 'students');