import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Chybí proměnná prostředí MONGODB_URI');
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB připojeno (databáze: ${mongoose.connection.name})`);
}