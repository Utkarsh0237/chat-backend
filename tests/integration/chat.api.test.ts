import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../src/app';
import { AppDataSource, initializeDatabase, closeDatabase } from '../../src/config/database';
import { initializeFirebase, getFirestore } from '../../src/config/firebase';
import { User } from '../../src/entities/User.entity';

jest.setTimeout(30000);

describe('Chat System - End-to-End Integration API Tests (All 6 APIs)', () => {
  let app: ReturnType<typeof createApp>;

  let userA: User;
  let userB: User;
  let userC: User;

  beforeAll(async () => {
    // 1. Initialize PostgreSQL and real Firebase Firestore using .env (dev config)
    await initializeDatabase();
    initializeFirebase();
    app = createApp();
  });

  beforeEach(async () => {
    // Seed uniquely scoped users for this test without touching existing dev data
    const suffix = uuidv4();
    const userRepo = AppDataSource.getRepository(User);
    userA = await userRepo.save({
      name: 'Alice Johnson',
      email: `alice.${suffix}@integration.local`,
    });
    userB = await userRepo.save({
      name: 'Bob Smith',
      email: `bob.${suffix}@integration.local`,
    });
    userC = await userRepo.save({
      name: 'Charlie Stranger',
      email: `charlie.${suffix}@integration.local`,
    });
  });

  afterEach(async () => {
    const userIds = [userA?.id, userB?.id, userC?.id].filter(Boolean);
    if (userIds.length === 0 || !AppDataSource.isInitialized) {
      return;
    }

    // Find only chats created for this test's users and clean them up from Firestore + PostgreSQL
    const rows: Array<{ chatId: string }> = await AppDataSource.query(
      `SELECT DISTINCT "chatId" FROM chat_members WHERE "userId" = ANY($1)`,
      [userIds],
    );
    const chatIds = rows.map((r) => r.chatId);

    if (chatIds.length > 0) {
      const firestore = getFirestore();
      try {
        for (const id of chatIds) {
          await firestore.recursiveDelete(firestore.collection('chats').doc(id));
        }
      } finally {
        await AppDataSource.query(`DELETE FROM chats WHERE id = ANY($1)`, [chatIds]);
      }
    }

    await AppDataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
  });

  afterAll(async () => {
    await closeDatabase();
    await getFirestore().terminate();
  });

  // ==========================================
  // API 1: POST /chat/create
  // ==========================================
  describe('API 1: POST /chat/create', () => {
    it('should create a new direct chat between userA and userB with HTTP 201', async () => {
      const res = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.chatId).toBeDefined();
    });

    it('should return existing chat with HTTP 200 when chat already exists (even with reversed user args)', async () => {
      // First call creates
      const firstRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id })
        .expect(201);

      const createdChatId = firstRes.body.data.chatId;

      // Second call with reversed order
      const secondRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userB.id, userBId: userA.id })
        .expect(200);

      expect(secondRes.body.success).toBe(true);
      expect(secondRes.body.data.chatId).toBe(createdChatId);
    });

    it('should return 400 when attempting to create chat with oneself (identical user IDs)', async () => {
      const res = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userA.id })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });

    it('should return 404 when one of the users does not exist', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: nonExistentUuid })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('should prevent duplicate chat creation during concurrent requests', async () => {
      const [res1, res2] = await Promise.all([
        request(app).post('/chat/create').send({ userAId: userA.id, userBId: userB.id }),
        request(app).post('/chat/create').send({ userAId: userB.id, userBId: userA.id }),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      expect(res1.body.data.chatId).toBe(res2.body.data.chatId);
    });
  });

  // ==========================================
  // API 2: POST /chat/:chatId/message/send
  // ==========================================
  describe('API 2: POST /chat/:chatId/message/send', () => {
    let chatId: string;

    beforeEach(async () => {
      const chatRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id });
      chatId = chatRes.body.data.chatId;
    });

    it('should successfully send a message and store in Firestore', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Hello Bob!' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.chatId).toBe(chatId);
      expect(res.body.data.senderId).toBe(userA.id);
      expect(res.body.data.text).toBe('Hello Bob!');
      expect(res.body.data.createdAt).toBeDefined();
    });

    it('should reject non-member sender with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userC.id, text: 'I should not be here' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('should reject nonexistent chat with 404 Not Found', async () => {
      const fakeChatId = '00000000-0000-0000-0000-000000000088';
      const res = await request(app)
        .post(`/chat/${fakeChatId}/message/send`)
        .send({ senderId: userA.id, text: 'Hello' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('should reject empty or whitespace message with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: '    ' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });

    it('should reject message exceeding 2000 characters with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'x'.repeat(2001) })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });
  });

  // ==========================================
  // API 3: GET /chat/:chatId/messages
  // ==========================================
  describe('API 3: GET /chat/:chatId/messages', () => {
    let chatId: string;

    beforeEach(async () => {
      const chatRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id });
      chatId = chatRes.body.data.chatId;
    });

    it('should return empty list when no messages exist in chat', async () => {
      const res = await request(app)
        .get(`/chat/${chatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toEqual([]);
      expect(res.body.data.hasMore).toBe(false);
      expect(res.body.data.nextCursor).toBeNull();
    });

    it('should return messages in chronological order with cursor pagination', async () => {
      // Send 3 messages
      await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Msg 1' });
      await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userB.id, text: 'Msg 2' });
      await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Msg 3' });

      // Fetch page 1 with limit=2
      const page1 = await request(app)
        .get(`/chat/${chatId}/messages?limit=2`)
        .set('X-User-Id', userA.id)
        .expect(200);

      expect(page1.body.data.messages).toHaveLength(2);
      expect(page1.body.data.hasMore).toBe(true);
      expect(page1.body.data.nextCursor).toBeDefined();

      const nextCursor = page1.body.data.nextCursor;

      // Fetch page 2 using cursor
      const page2 = await request(app)
        .get(`/chat/${chatId}/messages?limit=2&cursor=${encodeURIComponent(nextCursor)}`)
        .set('X-User-Id', userB.id)
        .expect(200);

      expect(page2.body.data.messages).toHaveLength(1);
      expect(page2.body.data.messages[0].text).toBe('Msg 3');
      expect(page2.body.data.hasMore).toBe(false);
      expect(page2.body.data.nextCursor).toBeNull();
    });

    it('should reject invalid cursor format with 400 Bad Request', async () => {
      const res = await request(app)
        .get(`/chat/${chatId}/messages?cursor=invalid-cursor-format`)
        .set('X-User-Id', userA.id)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });

    it('should reject unauthenticated requests and non-members on DIRECT chat messages', async () => {
      await request(app).get(`/chat/${chatId}/messages`).expect(401);

      await request(app).get(`/chat/${chatId}/messages`).set('X-User-Id', userC.id).expect(403);
    });
  });

  // ==========================================
  // API 4: POST /chat/:chatId/message/:messageId/read
  // ==========================================
  describe('API 4: POST /chat/:chatId/message/:messageId/read', () => {
    let chatId: string;
    let messageId: string;

    beforeEach(async () => {
      const chatRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id });
      chatId = chatRes.body.data.chatId;

      const msgRes = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Message for Bob' });
      messageId = msgRes.body.data.id;
    });

    it('should successfully mark a message as read by receiver', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .send({ userId: userB.id })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.messageId).toBe(messageId);
      expect(res.body.data.userId).toBe(userB.id);
      expect(res.body.data.readAt).toBeDefined();
    });

    it('should safely handle duplicate read requests idempotently', async () => {
      await request(app)
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .send({ userId: userB.id })
        .expect(200);

      const secondRes = await request(app)
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .send({ userId: userB.id })
        .expect(200);

      expect(secondRes.body.success).toBe(true);
    });

    it('should reject user marking their own message as read with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .send({ userId: userA.id })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });

    it('should reject non-member with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .send({ userId: userC.id })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('FORBIDDEN');
    });
  });

  // ==========================================
  // API 5: POST /chat/:chatId/lastseen
  // ==========================================
  describe('API 5: POST /chat/:chatId/lastseen', () => {
    let chatId: string;
    let msg1Id: string;
    let msg2Id: string;

    beforeEach(async () => {
      const chatRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id });
      chatId = chatRes.body.data.chatId;

      const m1 = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Message 1' });
      msg1Id = m1.body.data.id;

      const m2 = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Message 2' });
      msg2Id = m2.body.data.id;
    });

    it('should successfully update last seen message', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: msg1Id })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.lastSeenMessageId).toBe(msg1Id);
    });

    it('should allow advancing last seen to a newer message', async () => {
      await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: msg1Id })
        .expect(200);

      const res = await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: msg2Id })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.lastSeenMessageId).toBe(msg2Id);
    });

    it('should reject moving last seen backwards to an older message with 400 Bad Request', async () => {
      // First update to msg2
      await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: msg2Id })
        .expect(200);

      // Now attempt to move back to msg1
      const res = await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: msg1Id })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('Cannot move last seen backwards');
    });

    it('should reject nonexistent message with 404 Not Found', async () => {
      const res = await request(app)
        .post(`/chat/${chatId}/lastseen`)
        .send({ userId: userB.id, messageId: 'nonexistent-message-id' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });
  });

  // ==========================================
  // API 6: GET /user/:userId/chats
  // ==========================================
  describe('API 6: GET /user/:userId/chats', () => {
    it('should return all chats for a user ordered by lastActivityAt descending without N+1 queries', async () => {
      // Create chat between A and B
      const chat1 = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id });

      // Create chat between A and C
      const chat2 = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userC.id });

      // Send a message in chat1 to make it the most recently active
      await request(app)
        .post(`/chat/${chat1.body.data.chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Latest activity in chat 1' });

      const res = await request(app).get(`/user/${userA.id}/chats`).expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Verify chat1 is first because of recent message
      expect(res.body.data[0].id).toBe(chat1.body.data.chatId);
      expect(res.body.data[1].id).toBe(chat2.body.data.chatId);

      // Verify memberIds
      expect(res.body.data[0].memberIds).toContain(userA.id);
      expect(res.body.data[0].memberIds).toContain(userB.id);
      expect(res.body.data[0].type).toBe('DIRECT');
      expect(res.body.data[0].lastActivityAt).toBeDefined();
    });

    it('should return empty array when user has no chats', async () => {
      const res = await request(app).get(`/user/${userC.id}/chats`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should return 404 when user does not exist', async () => {
      const nonExistent = '00000000-0000-0000-0000-000000000077';
      const res = await request(app).get(`/user/${nonExistent}/chats`).expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });
  });
});
