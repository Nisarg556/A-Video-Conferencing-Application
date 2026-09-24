import request from 'supertest';
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

let userCounter = 0;
export const TEST_PASSWORD = 'correct-horse-battery';

/** Registers a new user and returns a supertest agent that keeps their session cookie. */
export async function signUp(app, { name = 'Test User' } = {}) {
  const agent = request.agent(app);
  const email = `user${Date.now()}-${++userCounter}@example.com`;
  const res = await agent.post('/api/auth/register').send({ name, email, password: TEST_PASSWORD });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  agent.user = res.body.user;
  agent.email = email;
  return agent;
}

/** A signed-in user creates a meeting (they become its host). */
export async function createMeetingAs(agent, body = {}) {
  const res = await agent.post('/api/meetings').send(body);
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.meeting;
}
