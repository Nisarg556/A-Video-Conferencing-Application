import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { RoomManager } from '../src/realtime/roomManager.js';
import { attachSocketServer } from '../src/realtime/socketServer.js';

export async function startTestDb() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  return async () => {
    await mongoose.disconnect();
    await mongo.stop();
  };
}

export async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

/** Real HTTP + Socket.IO server on a random port, sharing one RoomManager. */
export async function startTestServer() {
  const rooms = new RoomManager();
  const app = createApp({ rooms });
  const server = http.createServer(app);
  const realtime = attachSocketServer(server, { rooms });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${server.address().port}`;
  return { app, rooms, url, close: () => realtime.close() };
}

/** Connects a socket with a participant token; resolves once connected. */
export function connectSocket(url, token) {
  const socket = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

export function emitWithAck(socket, event, payload = {}) {
  return socket.timeout(2000).emitWithAck(event, payload);
}

export function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}
