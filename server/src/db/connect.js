import mongoose from 'mongoose';

export async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected (${mongoose.connection.name})`);
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}
