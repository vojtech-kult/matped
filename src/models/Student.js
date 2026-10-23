import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema(
  {
    // String, ne Number: zachová počáteční nuly (např. 004217)
    studentNumber: { type: String, required: true, unique: true, match: /^\d{6}$/ },
    name: { type: String, trim: true, maxlength: 100, default: '' },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const Student = mongoose.model('Student', studentSchema, 'students');