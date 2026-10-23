import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Admin } from '../models/Admin.js';
import { hashPassword } from '../utils/password.js';
import { isValidPassword } from '../utils/validate.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!email || !isValidPassword(password) || password.length < 12) {
  console.error('Nastavte ADMIN_EMAIL a ADMIN_PASSWORD (12 až 72 znaků).');
  process.exit(1);
}

await connectDB();
await Admin.findOneAndUpdate(
  { email },
  { passwordHash: await hashPassword(password) },
  { upsert: true }
);
console.log(`Admin účet ${email} je nastaven.`);
await mongoose.disconnect();