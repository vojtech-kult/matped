import mongoose from 'mongoose';
import { EXAMPLE_LABELS, MIN_DIFFICULTY, MAX_DIFFICULTY } from '../config/examples.js';

const exampleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, maxlength: 10000 }, // LaTeX
    hash: { type: String, required: true, unique: true, select: false }, // brání vložení stejného příkladu dvakrát
    label: { type: String, required: true, enum: EXAMPLE_LABELS },
    difficulty: {
      type: Number,
      required: true,
      min: MIN_DIFFICULTY,
      max: MAX_DIFFICULTY,
      validate: { validator: Number.isInteger, message: 'Obtížnost musí být celé číslo' },
    },
  },
  { timestamps: true }
);

exampleSchema.index({ label: 1, difficulty: 1 });

export const Example = mongoose.model('Example', exampleSchema, 'examples');