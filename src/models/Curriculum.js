import mongoose from 'mongoose';

// Upravené kurikulum (přijímačky / maturita). Dokud dokument neexistuje, platí výchozí
// kurikulum z config/curriculum*.js. ID podtémat se nikdy nemění – váže se na ně postup studentů.
const videoSchema = new mongoose.Schema(
  { id: { type: String, required: true }, title: { type: String, required: true, maxlength: 100 }, url: { type: String, required: true, maxlength: 300 } },
  { _id: false }
);

const sectionSchema = new mongoose.Schema(
  { id: { type: String, required: true }, title: { type: String, required: true, maxlength: 150 }, videos: { type: [videoSchema], default: [] } },
  { _id: false }
);

const levelSchema = new mongoose.Schema(
  { level: { type: Number, required: true }, title: { type: String, required: true, maxlength: 100 }, sections: { type: [sectionSchema], default: [] } },
  { _id: false }
);

const curriculumSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, enum: ['prijimacky', 'maturita'] },
    version: { type: Number, required: true, default: 1 }, // hlídá souběžné úpravy
    levels: { type: [levelSchema], default: [] },
  },
  { timestamps: true }
);

export const Curriculum = mongoose.model('Curriculum', curriculumSchema);