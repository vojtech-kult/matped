import mongoose from 'mongoose';

// 'contact' = starší záznamy z jednoduchého formuláře
export const FORM_TYPES = ['contact', 'poptavka', 'dotaz', 'hodnoceni'];

const formSubmissionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: FORM_TYPES, required: true, default: 'poptavka' },
    name: { type: String, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 30 },
    message: { type: String, trim: true, maxlength: 2000 },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: 'Hodnocení musí být celé číslo' },
    },
    consent: { type: Boolean, required: true },
    discord: {
      notifiedAt: Date,
      error: String,
    },
  },
  { timestamps: true }
);

// třetí parametr = název kolekce v databázi
export const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema, 'forms');