import mongoose from 'mongoose';

const testItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    topic: { type: String, trim: true },
    difficulty: { type: Number, min: 1, max: 5, default: 1 },
  },
  { timestamps: true }
);

// třetí parametr = přesný název kolekce v databázi
export const TestItem = mongoose.model('TestItem', testItemSchema, 'test_items');