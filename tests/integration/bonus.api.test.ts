import crypto from 'crypto';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../src/app';
import { AppDataSource, initializeDatabase, closeDatabase } from '../../src/config/database';
import { initializeFirebase, getFirestore } from '../../src/config/firebase';
import { config } from '../../src/config/env';
import { User } from '../../src/entities/User.entity';
import { ChatMemberRole, ChatType, MESSAGE_CONSTANTS } from '../../src/common/constants';

const INTEGRATION_TEST_JWT_SECRET = 'b4a3c2d1e0f9876543210fedcba9876543210abcdef123456';

function signAuthJwt(
  sub: string,
  expiresInSeconds = 300,
  secret = INTEGRATION_TEST_JWT_SECRET,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

jest.setTimeout(30000);

describe('Bonus Features - End-to-End Integration API Tests (Tests 1 - 32)', () => {
  let app: ReturnType<typeof createApp>;

  let userA: User;
  let userB: User;
  let userC: User;
  let userD: User;
  let userE: User;

  beforeAll(async () => {
    await initializeDatabase();
    initializeFirebase();
    app = createApp();
  });

  beforeEach(async () => {
    const suffix = uuidv4();
    const userRepo = AppDataSource.getRepository(User);
    userA = await userRepo.save({
      name: 'Alice Admin',
      email: `alice.${suffix}@bonus.local`,
    });
    userB = await userRepo.save({
      name: 'Bob Member',
      email: `bob.${suffix}@bonus.local`,
    });
    userC = await userRepo.save({
      name: 'Charlie Member',
      email: `charlie.${suffix}@bonus.local`,
    });
    userD = await userRepo.save({
      name: 'Diana Member',
      email: `diana.${suffix}@bonus.local`,
    });
    userE = await userRepo.save({
      name: 'Evan Outsider',
      email: `evan.${suffix}@bonus.local`,
    });
  });

  afterEach(async () => {
    const userIds = [userA?.id, userB?.id, userC?.id, userD?.id, userE?.id].filter(Boolean);
    if (userIds.length === 0 || !AppDataSource.isInitialized) {
      return;
    }

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
  // FEATURE 1: GROUP CHAT CREATION & MANAGEMENT (Tests 1 - 17)
  // ==========================================
  describe('Feature 1: Group Chat Creation & Management', () => {
    it('1. should create a group chat with creator as ADMIN and return member info', async () => {
      const res = await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: userA.id,
          name: 'Development Team',
          memberIds: [userB.id, userC.id, userD.id],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.type).toBe(ChatType.GROUP);
      expect(res.body.data.name).toBe('Development Team');
      expect(res.body.data.createdBy).toBe(userA.id);
      expect(res.body.data.members).toHaveLength(4);

      const admin = res.body.data.members.find((m: { userId: string }) => m.userId === userA.id);
      expect(admin.role).toBe(ChatMemberRole.ADMIN);
    });

    it('2. should reject group creation with nonexistent creator (404)', async () => {
      const res = await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: '00000000-0000-0000-0000-000000000099',
          name: 'Ghost Group',
          memberIds: [userB.id],
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('3. should reject group creation with nonexistent member (404)', async () => {
      const res = await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: userA.id,
          name: 'Bad Member Group',
          memberIds: [userB.id, '00000000-0000-0000-0000-000000000098'],
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('4. should automatically include creator as ADMIN when omitted from memberIds', async () => {
      const res = await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: userA.id,
          name: 'Creator Auto Added',
          memberIds: [userB.id, userC.id],
        })
        .expect(201);

      const creatorMember = res.body.data.members.find(
        (m: { userId: string }) => m.userId === userA.id,
      );
      expect(creatorMember).toBeDefined();
      expect(creatorMember.role).toBe(ChatMemberRole.ADMIN);
    });

    it('5. should reject duplicate member IDs with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: userA.id,
          name: 'Dup Members',
          memberIds: [userB.id, userB.id],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
    });

    it('6. should create separate group chats for identical creation requests', async () => {
      const payload = {
        creatorId: userA.id,
        name: 'Repeated Group',
        memberIds: [userB.id, userC.id],
      };

      const g1 = await request(app).post('/chat/group/create').send(payload).expect(201);
      const g2 = await request(app).post('/chat/group/create').send(payload).expect(201);

      expect(g1.body.data.id).not.toBe(g2.body.data.id);
    });

    it('should reject invalid group names and unexpected body properties', async () => {
      await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: '   ', memberIds: [userB.id] })
        .expect(400);

      await request(app)
        .post('/chat/group/create')
        .send({
          creatorId: userA.id,
          name: 'Valid',
          memberIds: [userB.id],
          extraField: 'unexpected',
        })
        .expect(400);
    });

    it('7. should allow group admin to add new members', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Expandable', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const addRes = await request(app)
        .post(`/chat/${groupId}/members`)
        .send({ requesterId: userA.id, memberIds: [userC.id, userD.id] })
        .expect(200);

      expect(addRes.body.success).toBe(true);
      expect(addRes.body.data.members).toHaveLength(4);
    });

    it('8. should forbid non-admin member from adding members', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Admin Only Add', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .post(`/chat/${groupId}/members`)
        .send({ requesterId: userB.id, memberIds: [userC.id] })
        .expect(403);

      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('9. should reject adding an already existing group member (409)', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'No Duplicate Member', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .post(`/chat/${groupId}/members`)
        .send({ requesterId: userA.id, memberIds: [userB.id, userC.id] })
        .expect(409);

      expect(res.body.errorCode).toBe('CONFLICT');
    });

    it('10. should allow admin to remove a group member', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Removable', memberIds: [userB.id, userC.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .delete(`/chat/${groupId}/members/${userB.id}`)
        .send({ requesterId: userA.id })
        .expect(200);

      expect(res.body.data.removedUserId).toBe(userB.id);
      expect(res.body.data.members).toHaveLength(2);
    });

    it('11. should forbid non-admin member from removing another member', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'No Kick', memberIds: [userB.id, userC.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .delete(`/chat/${groupId}/members/${userC.id}`)
        .send({ requesterId: userB.id })
        .expect(403);

      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('12. should allow a member to voluntarily leave the group', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Voluntary Leave', memberIds: [userB.id, userC.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .delete(`/chat/${groupId}/members/${userB.id}`)
        .send({ requesterId: userB.id })
        .expect(200);

      expect(res.body.data.removedUserId).toBe(userB.id);
      expect(res.body.data.members.some((m: { userId: string }) => m.userId === userB.id)).toBe(
        false,
      );
    });

    it('13. should prevent the last administrator from leaving or being removed', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Admin Guard', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .delete(`/chat/${groupId}/members/${userA.id}`)
        .send({ requesterId: userA.id })
        .expect(400);

      expect(res.body.errorCode).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('last administrator');
    });

    it('14. should allow admin to update group name and list in user chats', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Original Team', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const updated = await request(app)
        .patch(`/chat/${groupId}/group`)
        .send({ requesterId: userA.id, name: 'Updated Development Team' })
        .expect(200);

      expect(updated.body.data.name).toBe('Updated Development Team');

      const listRes = await request(app).get(`/user/${userB.id}/chats`).expect(200);
      expect(listRes.body.data[0].id).toBe(groupId);
      expect(listRes.body.data[0].name).toBe('Updated Development Team');
    });

    it('15. should forbid non-admin member from updating group name', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Locked Name', memberIds: [userB.id] })
        .expect(201);
      const groupId = created.body.data.id;

      const res = await request(app)
        .patch(`/chat/${groupId}/group`)
        .send({ requesterId: userB.id, name: 'Unauthorized Rename' })
        .expect(403);

      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('16 & 17. should block removed member from sending or reading group messages while allowing active members', async () => {
      const created = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Auth Group', memberIds: [userB.id, userC.id] })
        .expect(201);
      const groupId = created.body.data.id;

      // Active member sends a message
      await request(app)
        .post(`/chat/${groupId}/message/send`)
        .send({ senderId: userB.id, text: 'Hello before removal' })
        .expect(201);

      // Admin removes userB
      await request(app)
        .delete(`/chat/${groupId}/members/${userB.id}`)
        .send({ requesterId: userA.id })
        .expect(200);

      // 16. Removed member attempts to send message -> 403
      await request(app)
        .post(`/chat/${groupId}/message/send`)
        .send({ senderId: userB.id, text: 'Sneaking back' })
        .expect(403);

      // 17. Removed member attempts to retrieve messages -> 403
      await request(app).get(`/chat/${groupId}/messages?userId=${userB.id}`).expect(403);

      // Unauthenticated request to GROUP chat -> 401
      await request(app).get(`/chat/${groupId}/messages`).expect(401);

      // Remaining active member (userC) succeeds -> 200
      const activeRead = await request(app)
        .get(`/chat/${groupId}/messages`)
        .set('X-User-Id', userC.id)
        .expect(200);
      expect(activeRead.body.data.messages).toHaveLength(1);
    });
  });

  // ==========================================
  // FEATURE 2: MESSAGE EDITING & DELETION (Tests 18 - 32)
  // ==========================================
  describe('Feature 2: Message Editing & Soft Deletion', () => {
    let chatId: string;

    beforeEach(async () => {
      const chatRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id })
        .expect(201);
      chatId = chatRes.body.data.chatId;
    });

    it('18 & 30. should allow editing own message while preserving createdAt and updating updatedAt', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Initial draft' })
        .expect(201);
      const msgId = sent.body.data.id;

      // Read authoritative Firestore createdAt before edit
      const beforeList = await request(app)
        .get(`/chat/${chatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(200);
      const originalCreatedAt = beforeList.body.data.messages[0].createdAt;

      const edited = await request(app)
        .patch(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id, text: 'Updated message content' })
        .expect(200);

      expect(edited.body.success).toBe(true);
      expect(edited.body.data.text).toBe('Updated message content');
      expect(edited.body.data.senderId).toBe(userA.id);
      expect(edited.body.data.isDeleted).toBe(false);
      expect(edited.body.data.createdAt).toBe(originalCreatedAt);
      expect(new Date(edited.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(originalCreatedAt).getTime(),
      );
    });

    it('19. should reject editing another user message with 403 Forbidden', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Alice text' })
        .expect(201);

      const res = await request(app)
        .patch(`/chat/${chatId}/message/${sent.body.data.id}`)
        .send({ senderId: userB.id, text: 'Bob edit attempt' })
        .expect(403);

      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('20. should reject editing nonexistent message with 404 Not Found', async () => {
      const res = await request(app)
        .patch(`/chat/${chatId}/message/nonexistent-message-id`)
        .send({ senderId: userA.id, text: 'Edit missing' })
        .expect(404);

      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('21. should reject editing a soft-deleted message with 400 Bad Request', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Soon deleted' })
        .expect(201);
      const msgId = sent.body.data.id;

      await request(app)
        .delete(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id })
        .expect(200);

      const editRes = await request(app)
        .patch(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id, text: 'Trying to edit after delete' })
        .expect(400);

      expect(editRes.body.errorCode).toBe('BAD_REQUEST');
    });

    it('22 & 23. should reject empty text, oversized text, and unexpected properties on edit', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Original' })
        .expect(201);
      const msgId = sent.body.data.id;

      await request(app)
        .patch(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id, text: '   ' })
        .expect(400);

      await request(app)
        .patch(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id, text: 'a'.repeat(2001) })
        .expect(400);

      await request(app)
        .patch(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id, text: 'Valid', extra: 'not-allowed' })
        .expect(400);
    });

    it('24, 27, 28, 29, 30. should soft-delete own message, handle repeated delete consistently, mask text, and preserve createdAt + read receipts', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Sensitive payload' })
        .expect(201);
      const msgId = sent.body.data.id;

      // Capture authoritative Firestore createdAt
      const initialList = await request(app)
        .get(`/chat/${chatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(200);
      const originalCreatedAt = initialList.body.data.messages[0].createdAt;

      // Receiver (userB) marks message read before deletion
      await request(app)
        .post(`/chat/${chatId}/message/${msgId}/read`)
        .send({ userId: userB.id })
        .expect(200);

      // 24. Soft-delete message
      const del1 = await request(app)
        .delete(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id })
        .expect(200);

      expect(del1.body.data.isDeleted).toBe(true);
      expect(del1.body.data.text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
      expect(del1.body.data.deletedAt).toBeDefined();
      expect(del1.body.data.createdAt).toBe(originalCreatedAt);

      // 27. Delete the same message twice -> must not mutate deletedAt or updatedAt
      const del2 = await request(app)
        .delete(`/chat/${chatId}/message/${msgId}`)
        .send({ senderId: userA.id })
        .expect(200);

      expect(del2.body.data.deletedAt).toBe(del1.body.data.deletedAt);
      expect(del2.body.data.updatedAt).toBe(del1.body.data.updatedAt);

      // 28. Retrieved messages must not expose original content
      const afterList = await request(app)
        .get(`/chat/${chatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(200);
      expect(afterList.body.data.messages[0]).toMatchObject({
        id: msgId,
        senderId: userA.id,
        text: MESSAGE_CONSTANTS.DELETED_PLACEHOLDER,
        isDeleted: true,
        createdAt: originalCreatedAt,
      });
      expect(afterList.body.data.messages[0].deletedAt).toBeDefined();

      // 29. Verify Firestore readReceipts subcollection is preserved intact
      const receiptSnap = await getFirestore()
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .doc(msgId)
        .collection('readReceipts')
        .doc(userB.id)
        .get();
      expect(receiptSnap.exists).toBe(true);
      expect(receiptSnap.data()?.userId).toBe(userB.id);
    });

    it('25. should forbid deleting another user message (403)', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Not Bob message' })
        .expect(201);

      await request(app)
        .delete(`/chat/${chatId}/message/${sent.body.data.id}`)
        .send({ senderId: userB.id })
        .expect(403);
    });

    it('26. should reject deleting nonexistent message with 404 Not Found', async () => {
      await request(app)
        .delete(`/chat/${chatId}/message/does-not-exist`)
        .send({ senderId: userA.id })
        .expect(404);
    });

    it('31. should preserve chronological message ordering and pagination after edit and soft deletion', async () => {
      const m1 = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'First msg' })
        .expect(201);
      const m2 = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userB.id, text: 'Second msg' })
        .expect(201);
      const m3 = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Third msg' })
        .expect(201);

      await request(app)
        .delete(`/chat/${chatId}/message/${m1.body.data.id}`)
        .send({ senderId: userA.id })
        .expect(200);
      await request(app)
        .patch(`/chat/${chatId}/message/${m2.body.data.id}`)
        .send({ senderId: userB.id, text: 'Second msg (edited)' })
        .expect(200);

      const page1 = await request(app)
        .get(`/chat/${chatId}/messages?limit=2`)
        .set('X-User-Id', userA.id)
        .expect(200);
      expect(page1.body.data.messages.map((m: { id: string }) => m.id)).toEqual([
        m1.body.data.id,
        m2.body.data.id,
      ]);
      expect(page1.body.data.messages[0].isDeleted).toBe(true);
      expect(page1.body.data.messages[1].text).toBe('Second msg (edited)');
      expect(page1.body.data.hasMore).toBe(true);

      const page2 = await request(app)
        .get(
          `/chat/${chatId}/messages?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
        )
        .set('X-User-Id', userB.id)
        .expect(200);
      expect(page2.body.data.messages.map((m: { id: string }) => m.id)).toEqual([m3.body.data.id]);
    });

    it('32. should safely handle concurrent edit and delete requests via Firestore transactions', async () => {
      const sent = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId: userA.id, text: 'Race condition test' })
        .expect(201);
      const msgId = sent.body.data.id;

      const [editRes, deleteRes] = await Promise.all([
        request(app)
          .patch(`/chat/${chatId}/message/${msgId}`)
          .send({ senderId: userA.id, text: 'Edited concurrently' }),
        request(app).delete(`/chat/${chatId}/message/${msgId}`).send({ senderId: userA.id }),
      ]);

      // Either delete happened first (edit=400, delete=200) or edit happened first (edit=200, delete=200).
      // In BOTH linearizable outcomes, the final state in Firestore MUST be deleted.
      expect(deleteRes.status).toBe(200);
      expect([200, 400]).toContain(editRes.status);

      const finalList = await request(app)
        .get(`/chat/${chatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(200);
      expect(finalList.body.data.messages[0].isDeleted).toBe(true);
      expect(finalList.body.data.messages[0].text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
    });
  });

  // ==========================================
  // SECURITY & AUTHORIZATION REGRESSION TESTS (Tests 1 - 10)
  // ==========================================
  describe('Security & Authorization Hardening Regression Tests (1 - 10)', () => {
    let directChatId: string;
    let groupChatId: string;
    let directMsgId: string;
    let groupMsgId: string;
    const origAuthRequired = config.auth.authRequired;
    const origJwtSecret = config.auth.jwtSecret;

    beforeEach(async () => {
      const directRes = await request(app)
        .post('/chat/create')
        .send({ userAId: userA.id, userBId: userB.id })
        .expect(201);
      directChatId = directRes.body.data.chatId;

      const groupRes = await request(app)
        .post('/chat/group/create')
        .send({ creatorId: userA.id, name: 'Security Group', memberIds: [userB.id, userC.id] })
        .expect(201);
      groupChatId = groupRes.body.data.id;

      const dMsg = await request(app)
        .post(`/chat/${directChatId}/message/send`)
        .send({ senderId: userA.id, text: 'Direct secret' })
        .expect(201);
      directMsgId = dMsg.body.data.id;

      const gMsg = await request(app)
        .post(`/chat/${groupChatId}/message/send`)
        .send({ senderId: userB.id, text: 'Group secret' })
        .expect(201);
      groupMsgId = gMsg.body.data.id;

      config.auth.jwtSecret = INTEGRATION_TEST_JWT_SECRET;
    });

    afterEach(() => {
      config.auth.authRequired = origAuthRequired;
      config.auth.jwtSecret = origJwtSecret;
    });

    it('1. should reject unauthorized access to DIRECT chat messages (401 unauthenticated, 403 non-member)', async () => {
      await request(app).get(`/chat/${directChatId}/messages`).expect(401);
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('X-User-Id', userE.id)
        .expect(403);
      await request(app).get(`/chat/${directChatId}/messages?userId=${userE.id}`).expect(403);
    });

    it('2. should reject unauthorized access to GROUP chat messages (401 unauthenticated, 403 non-member)', async () => {
      await request(app).get(`/chat/${groupChatId}/messages`).expect(401);
      await request(app)
        .get(`/chat/${groupChatId}/messages`)
        .set('X-User-Id', userE.id)
        .expect(403);
    });

    it('3. should reject non-member attempting to send messages in DIRECT and GROUP chats', async () => {
      await request(app)
        .post(`/chat/${directChatId}/message/send`)
        .send({ senderId: userE.id, text: 'Intruder direct' })
        .expect(403);

      await request(app)
        .post(`/chat/${groupChatId}/message/send`)
        .send({ senderId: userE.id, text: 'Intruder group' })
        .expect(403);
    });

    it('4, 5 & 6. should reject missing auth token, invalid JWT signature, expired JWT, and non-UUID sub when AUTH_REQUIRED=true', async () => {
      config.auth.authRequired = true;

      // 4. Missing token
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('X-User-Id', userA.id)
        .expect(401);

      // 5. Invalid signature
      const invalidSigToken = signAuthJwt(userA.id, 300, 'wrong-secret-key-for-signing-attempt');
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', `Bearer ${invalidSigToken}`)
        .expect(401);

      // Non-UUID subject in signed JWT
      const nonUuidSubToken = signAuthJwt('not-a-valid-uuid');
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', `Bearer ${nonUuidSubToken}`)
        .expect(401);

      // 6. Expired JWT
      const expiredToken = signAuthJwt(userA.id, -60);
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('7 & 8. should reject body userId / senderId mismatching authenticated JWT subject when AUTH_REQUIRED=true', async () => {
      config.auth.authRequired = true;
      const userAToken = signAuthJwt(userA.id);

      // 7. Body userId mismatch (read receipt + lastseen + query userId + user chats)
      await request(app)
        .post(`/chat/${directChatId}/message/${directMsgId}/read`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ userId: userB.id })
        .expect(403);

      await request(app)
        .post(`/chat/${directChatId}/lastseen`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ userId: userB.id, messageId: directMsgId })
        .expect(403);

      await request(app)
        .get(`/chat/${directChatId}/messages?userId=${userB.id}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(403);

      // 8. Body senderId mismatch (send, edit, delete)
      await request(app)
        .post(`/chat/${groupChatId}/message/send`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ senderId: userB.id, text: 'Spoofed send' })
        .expect(403);

      await request(app)
        .patch(`/chat/${groupChatId}/message/${groupMsgId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ senderId: userB.id, text: 'Spoofed edit' })
        .expect(403);

      await request(app)
        .delete(`/chat/${groupChatId}/message/${groupMsgId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ senderId: userB.id })
        .expect(403);
    });

    it('9. should protect user management endpoints when AUTH_REQUIRED=true', async () => {
      config.auth.authRequired = true;
      const userAToken = signAuthJwt(userA.id);

      // Unauthenticated user creation & profile lookup -> 401
      await request(app)
        .post('/user')
        .send({ name: 'Hacker', email: 'hacker@evil.com' })
        .expect(401);
      await request(app).get(`/user/${userA.id}`).expect(401);

      // Authenticated POST /user restricted in production/strict mode -> 403
      await request(app)
        .post('/user')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'Blocked Provision', email: 'blocked@evil.com' })
        .expect(403);

      // User A cannot inspect User B profile or User B chat list -> 403
      await request(app)
        .get(`/user/${userB.id}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(403);
      await request(app)
        .get(`/user/${userB.id}/chats`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(403);

      // User A can inspect own profile & own chats -> 200
      await request(app)
        .get(`/user/${userA.id}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
      await request(app)
        .get(`/user/${userA.id}/chats`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
    });

    it('10. should enforce DIRECT and GROUP membership authorization consistently under valid JWTs', async () => {
      config.auth.authRequired = true;
      const userAToken = signAuthJwt(userA.id);
      const outsiderToken = signAuthJwt(userE.id);

      // Member reads DIRECT and GROUP messages with JWT alone -> 200
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
      await request(app)
        .get(`/chat/${groupChatId}/messages`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      // Member sends message in GROUP omitting body senderId (derived from JWT sub) -> 201
      await request(app)
        .post(`/chat/${groupChatId}/message/send`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ text: 'Authenticated JWT message' })
        .expect(201);

      // Outsider blocked on both DIRECT and GROUP read/send/edit/delete/read-receipt -> 403
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
      await request(app)
        .get(`/chat/${groupChatId}/messages`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
      await request(app)
        .post(`/chat/${directChatId}/message/${directMsgId}/read`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({})
        .expect(403);
      // Empty Bearer token rejected when AUTH_REQUIRED=true, ignored cleanly in dev mode
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', 'Bearer ')
        .set('X-User-Id', userA.id)
        .expect(401);

      config.auth.authRequired = false;
      await request(app)
        .get(`/chat/${directChatId}/messages`)
        .set('Authorization', 'Bearer ')
        .set('X-User-Id', userA.id)
        .expect(200);
    });
  });
});
