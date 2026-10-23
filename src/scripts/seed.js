import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { TestItem } from '../models/TestItem.js';

await connectDB();

await TestItem.deleteMany({});
await TestItem.insertMany([
  { title: 'Sčítání do 20', topic: 'aritmetika', difficulty: 1 },
  { title: 'Zlomky: krácení', topic: 'zlomky', difficulty: 3 },
  { title: 'Pythagorova věta', topic: 'geometrie', difficulty: 4 },
]);

console.log('Testovací data vložena.');
await mongoose.disconnect();