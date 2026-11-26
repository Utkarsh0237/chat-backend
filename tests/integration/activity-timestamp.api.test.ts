import request from 'supertest';
import { In } from 'typeorm';
import { createApp } from '../../src/app';
import { initializeDatabase, closeDatabase, AppDataSource } from '../../src/config/database';
import { initializeFirebase, getFirestore } from '../../src/config/firebase';
import { Chat } from '../../src/entities/Chat.entity';
import { ChatMember } from '../../src/entities/ChatMember.entity';
import { User } from '../../src/entities/User.entity';
import { ChatService } from '../../src/modules/chat/chat.service';

describe('Chat lastActivityAt vs Firestore Message Timestamp Integration Tests', () => {
  const app = createApp();
  const createdUserIds: string[] = [];
  const createdChatIds: string[] = [];

  let user1Id = '';
  let user2Id = '';
  let user3Id = '';

  const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initializeDatabase();
    initializeFirebase();

    const u1Res = await request(app)
      .post('/user')
      .send({ name: 'Sync User 1', email: `sync-u1-${runSuffix}@example.com` });
    expect(u1Res.status).toBe(201);
    user1Id = u1Res.body.data.id;
    createdUserIds.push(user1Id);

    const u2Res = await request(app)
      .post('/user')
      .send({ name: 'Sync User 2', email: `sync-u2-${runSuffix}@example.com` });
    expect(u2Res.status).toBe(201);
    user2Id = u2Res.body.data.id;
    createdUserIds.push(user2Id);

    const u3Res = await request(app)
      .post('/user')
      .send({ name: 'Sync User 3', email: `sync-u3-${runSuffix}@example.com` });
    expect(u3Res.status).toBe(201);
    user3Id = u3Res.body.data.id;
    createdUserIds.push(user3Id);
  }, 30000);

  afterAll(async () => {
    try {
      const db = getFirestore();
      for (const chatId of createdChatIds) {
        await db.recursiveDelete(db.collection('chats').doc(chatId));
      }

      if (AppDataSource.isInitialized) {
        if (createdChatIds.length > 0) {
          await AppDataSource.getRepository(ChatMember).delete({ chatId: In(createdChatIds) });
          await AppDataSource.getRepository(Chat).delete({ id: In(createdChatIds) });
        }
        if (createdUserIds.length > 0) {
          await AppDataSource.getRepository(User).delete({ id: In(createdUserIds) });
        }
      }
    } finally {
      await closeDatabase();
    }
  }, 30000);

  it('should match PostgreSQL chats.lastActivityAt exactly to Firestore committed createdAt', async () => {
    const chatRes = await request(app)
      .post('/chat/create')
      .send({ userAId: user1Id, userBId: user2Id });
    expect(chatRes.status).toBe(201);
    const chatId: string = chatRes.body.data.chatId;
    createdChatIds.push(chatId);

    // Wait briefly so initial chat creation timestamp precedes Firestore server clock safely
    await new Promise((r) => setTimeout(r, 300));

    const sendRes = await request(app)
      .post(`/chat/${chatId}/message/send`)
      .send({ senderId: user1Id, text: 'Authoritative Firestore server timestamp test' });
    expect(sendRes.status).toBe(201);
    const sentMsg = sendRes.body.data;

    await new Promise((r) => setTimeout(r, 50));

    const sendRes2 = await request(app)
      .post(`/chat/${chatId}/message/send`)
      .send({ senderId: user2Id, text: 'Second authoritative Firestore server timestamp test' });
    expect(sendRes2.status).toBe(201);
    const sentMsg2 = sendRes2.body.data;

    const listMsgRes = await request(app)
      .get(`/chat/${chatId}/messages`)
      .query({ userId: user1Id, limit: 10 });
    expect(listMsgRes.status).toBe(200);
    expect(listMsgRes.body.data.messages).toHaveLength(2);
    const firestoreMsg1 = listMsgRes.body.data.messages[0];
    const firestoreMsg2 = listMsgRes.body.data.messages[1];

    expect(sentMsg.createdAt).toBe(firestoreMsg1.createdAt);
    expect(sentMsg2.createdAt).toBe(firestoreMsg2.createdAt);

    const userChatsRes = await request(app).get(`/user/${user1Id}/chats`);
    expect(userChatsRes.status).toBe(200);
    const targetChat = userChatsRes.body.data.find(
      (c: { id: string; lastActivityAt: string }) => c.id === chatId,
    );
    expect(targetChat).toBeDefined();

    // PostgreSQL lastActivityAt must exactly match the latest committed Firestore message createdAt
    expect(new Date(targetChat.lastActivityAt).toISOString()).toBe(
      new Date(firestoreMsg2.createdAt).toISOString(),
    );
  }, 30000);

  it('should never let an older out-of-order recordActivity overwrite a newer PostgreSQL lastActivityAt', async () => {
    const chatRes = await request(app)
      .post('/chat/create')
      .send({ userAId: user2Id, userBId: user3Id });
    expect(chatRes.status).toBe(201);
    const chatId: string = chatRes.body.data.chatId;
    createdChatIds.push(chatId);

    const chatService = new ChatService();
    const newerTimestamp = new Date(Date.now() + 60_000);
    const staleTimestamp = new Date(Date.now() + 10_000);

    await chatService.recordActivity(chatId, newerTimestamp);
    await chatService.recordActivity(chatId, staleTimestamp);

    const savedChat = await AppDataSource.getRepository(Chat).findOneBy({ id: chatId });
    expect(savedChat).not.toBeNull();
    expect(savedChat!.lastActivityAt.toISOString()).toBe(newerTimestamp.toISOString());
  }, 30000);

  it('should keep PostgreSQL lastActivityAt aligned with the newest Firestore message under concurrent sends', async () => {
    const chatRes = await request(app)
      .post('/chat/create')
      .send({ userAId: user1Id, userBId: user3Id });
    expect(chatRes.status).toBe(201);
    const chatId: string = chatRes.body.data.chatId;
    createdChatIds.push(chatId);

    // Wait briefly so initial chat creation timestamp is earlier than all concurrent messages
    await new Promise((r) => setTimeout(r, 300));

    const sendResponses = await Promise.all([
      request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: user1Id, text: 'Concurrent msg 1' }),
      request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: user3Id, text: 'Concurrent msg 2' }),
      request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: user1Id, text: 'Concurrent msg 3' }),
      request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: user3Id, text: 'Concurrent msg 4' }),
      request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: user1Id, text: 'Concurrent msg 5' }),
    ]);

    for (const res of sendResponses) {
      expect(res.status).toBe(201);
    }

    const listMsgRes = await request(app)
      .get(`/chat/${chatId}/messages`)
      .query({ userId: user1Id, limit: 20 });
    expect(listMsgRes.status).toBe(200);
    const messages: Array<{ createdAt: string }> = listMsgRes.body.data.messages;
    expect(messages).toHaveLength(5);

    const latestFirestoreMs = Math.max(...messages.map((m) => new Date(m.createdAt).getTime()));

    const userChatsRes = await request(app).get(`/user/${user1Id}/chats`);
    expect(userChatsRes.status).toBe(200);
    const targetChat = userChatsRes.body.data.find(
      (c: { id: string; lastActivityAt: string }) => c.id === chatId,
    );
    expect(targetChat).toBeDefined();

    const pgLastActivityMs = new Date(targetChat.lastActivityAt).getTime();
    expect(pgLastActivityMs).toBe(latestFirestoreMs);
  }, 30000);
});
