import * as admin from 'firebase-admin';
import { MessageRepository } from '../../src/modules/message/message.repository';
import { MessageService } from '../../src/modules/message/message.service';
import { ChatService } from '../../src/modules/chat/chat.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../src/common/errors';
import { MESSAGE_CONSTANTS } from '../../src/common/constants';
import { FIXTURE_USER_A, FIXTURE_USER_B } from '../fixtures/test-data';

interface StoredMessage {
  senderId: string;
  text: string;
  isDeleted?: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

/**
 * Lightweight unit-test Firestore double that executes real MessageRepository
 * Firestore transactions, snapshots, ordering, and readReceipts subcollection state
 * without requiring network access.
 */
function createInMemoryRepoFirestore() {
  const chats = new Map<
    string,
    {
      messages: Map<string, StoredMessage>;
      readReceipts: Map<string, Map<string, { userId: string; readAt: Date }>>;
    }
  >();

  let tick = 1700000000000;
  const nextDate = () => {
    tick += 100;
    return new Date(tick);
  };

  function resolveValues(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (
        v &&
        typeof v === 'object' &&
        (v as { constructor?: { name?: string } }).constructor?.name === 'ServerTimestampTransform'
      ) {
        out[k] = nextDate();
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function ensureChat(chatId: string) {
    let c = chats.get(chatId);
    if (!c) {
      c = { messages: new Map(), readReceipts: new Map() };
      chats.set(chatId, c);
    }
    return c;
  }

  let autoId = 0;

  function makeDocRef(chatId: string, msgId: string) {
    return {
      id: msgId,
      path: `chats/${chatId}/messages/${msgId}`,
      async get() {
        const msg = chats.get(chatId)?.messages.get(msgId);
        return {
          id: msgId,
          exists: Boolean(msg),
          data: () => (msg ? { ...msg } : undefined),
        };
      },
      async set(data: Record<string, unknown>) {
        const chat = ensureChat(chatId);
        const resolved = resolveValues(data);
        chat.messages.set(msgId, resolved as unknown as StoredMessage);
      },
      collection(subName: string) {
        if (subName !== 'readReceipts') {
          throw new Error(`Unsupported subcollection: ${subName}`);
        }
        return {
          doc(userId: string) {
            return {
              async get() {
                const receipt = chats.get(chatId)?.readReceipts.get(msgId)?.get(userId);
                return {
                  id: userId,
                  exists: Boolean(receipt),
                  data: () => (receipt ? { ...receipt } : undefined),
                };
              },
              async set(data: Record<string, unknown>) {
                const chat = ensureChat(chatId);
                let map = chat.readReceipts.get(msgId);
                if (!map) {
                  map = new Map();
                  chat.readReceipts.set(msgId, map);
                }
                const resolved = resolveValues(data);
                map.set(userId, resolved as { userId: string; readAt: Date });
              },
            };
          },
        };
      },
    };
  }

  // Serial mutex to emulate real Firestore optimistic concurrency / transaction serialization
  let txChain = Promise.resolve();

  const db = {
    collection(name: string) {
      if (name !== 'chats') throw new Error(`Unsupported collection: ${name}`);
      return {
        doc(chatId: string) {
          return {
            collection(subName: string) {
              if (subName !== 'messages') throw new Error(`Unsupported subcollection: ${subName}`);
              return {
                doc(msgId?: string) {
                  const id = msgId || `msg_${++autoId}`;
                  return makeDocRef(chatId, id);
                },
                orderBy() {
                  return buildQuery(chatId, []);
                },
              };
            },
          };
        },
      };
    },
    async runTransaction<T>(fn: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
      const run = txChain.then(async () => {
        const pendingUpdates: Array<() => void> = [];
        const tx = {
          async get(ref: { get: () => Promise<unknown> }) {
            return ref.get();
          },
          update(ref: { path: string }, updates: Record<string, unknown>) {
            const [, chatId, , msgId] = ref.path.split('/');
            pendingUpdates.push(() => {
              const existing = chats.get(chatId)?.messages.get(msgId);
              if (existing) {
                const resolved = resolveValues(updates);
                chats.get(chatId)!.messages.set(msgId, {
                  ...existing,
                  ...resolved,
                } as StoredMessage);
              }
            });
          },
        };
        const result = await fn(tx);
        for (const apply of pendingUpdates) {
          apply();
        }
        return result;
      });
      txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  function buildQuery(chatId: string, afterCursor: unknown[]) {
    let limitCount = 50;
    const q = {
      orderBy() {
        return q;
      },
      startAfter(...args: unknown[]) {
        afterCursor = args;
        return q;
      },
      limit(n: number) {
        limitCount = n;
        return q;
      },
      async get() {
        const msgs = Array.from(chats.get(chatId)?.messages.entries() ?? []);
        msgs.sort((a, b) => {
          const diff = a[1].createdAt.getTime() - b[1].createdAt.getTime();
          if (diff !== 0) return diff;
          return a[0].localeCompare(b[0]);
        });

        let startIndex = 0;
        if (afterCursor.length === 2) {
          const cursorId = afterCursor[1] as string;
          const idx = msgs.findIndex(([id]) => id === cursorId);
          startIndex = idx >= 0 ? idx + 1 : msgs.length;
        }

        const sliced = msgs.slice(startIndex, startIndex + limitCount);
        return {
          empty: sliced.length === 0,
          docs: sliced.map(([id, data]) => ({
            id,
            data: () => ({ ...data }),
          })),
        };
      },
    };
    return q;
  }

  return {
    db: db as unknown as admin.firestore.Firestore,
    seedReadReceipt(chatId: string, msgId: string, userId: string) {
      const chat = ensureChat(chatId);
      let map = chat.readReceipts.get(msgId);
      if (!map) {
        map = new Map();
        chat.readReceipts.set(msgId, map);
      }
      const readAt = new Date('2026-01-01T12:00:00Z');
      map.set(userId, { userId, readAt });
      return readAt;
    },
    getReadReceipt(chatId: string, msgId: string, userId: string) {
      return chats.get(chatId)?.readReceipts.get(msgId)?.get(userId);
    },
  };
}

describe('Message Editing & Deletion - Unit Tests (Bonus Tests 18 - 32)', () => {
  let repo: MessageRepository;
  let messageService: MessageService;
  let mockChatService: jest.Mocked<ChatService>;
  let store: ReturnType<typeof createInMemoryRepoFirestore>;
  const chatId = 'chat-uuid-0001';

  beforeEach(() => {
    store = createInMemoryRepoFirestore();
    repo = new MessageRepository(store.db);
    mockChatService = {
      getChatById: jest.fn().mockResolvedValue({ id: chatId, type: 'DIRECT' }),
      verifyMembership: jest.fn().mockResolvedValue(undefined),
      recordActivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChatService>;
    messageService = new MessageService(repo, mockChatService);
  });

  // Bonus Test 18: Edit own message
  it('18. should allow sender to edit their own message and update updatedAt', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Original text');
    const initial = await messageService.getMessageById(chatId, sent.id);

    const edited = await messageService.editMessage(
      chatId,
      sent.id,
      FIXTURE_USER_A.id,
      '  Updated message content  ',
    );

    expect(edited.text).toBe('Updated message content');
    expect(edited.senderId).toBe(FIXTURE_USER_A.id);
    expect(edited.isDeleted).toBe(false);
    expect(edited.createdAt).toBe(initial?.createdAt);
    expect(new Date(edited.updatedAt).getTime()).toBeGreaterThan(
      new Date(initial!.updatedAt).getTime(),
    );
  });

  // Bonus Test 19: Edit another user's message
  it('19. should forbid editing a message sent by another user', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Alice message');

    await expect(
      messageService.editMessage(chatId, sent.id, FIXTURE_USER_B.id, 'Tampered'),
    ).rejects.toThrow(ForbiddenError);

    const stored = await messageService.getMessageById(chatId, sent.id);
    expect(stored?.text).toBe('Alice message');
  });

  // Bonus Test 20: Edit nonexistent message
  it('20. should reject editing a nonexistent message with NotFoundError', async () => {
    await expect(
      messageService.editMessage(chatId, 'missing-msg-id', FIXTURE_USER_A.id, 'Updated'),
    ).rejects.toThrow(NotFoundError);
  });

  // Bonus Test 21: Edit deleted message
  it('21. should prevent editing an already soft-deleted message', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'To be deleted');
    await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);

    await expect(
      messageService.editMessage(chatId, sent.id, FIXTURE_USER_A.id, 'Resurrected'),
    ).rejects.toThrow(BadRequestError);
  });

  // Bonus Test 22: Edit with empty text
  it('22. should reject editing with empty or whitespace-only text', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Valid');

    await expect(
      messageService.editMessage(chatId, sent.id, FIXTURE_USER_A.id, '   \t\n '),
    ).rejects.toThrow(BadRequestError);
    expect(mockChatService.verifyMembership).toHaveBeenCalledTimes(1); // Only for send
  });

  // Bonus Test 23: Edit with excessive text length
  it('23. should reject editing with text exceeding 2000 characters', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Valid');
    const tooLong = 'x'.repeat(MESSAGE_CONSTANTS.MAX_LENGTH + 1);

    await expect(
      messageService.editMessage(chatId, sent.id, FIXTURE_USER_A.id, tooLong),
    ).rejects.toThrow(BadRequestError);
  });

  // Bonus Test 24: Delete own message
  it('24. should soft-delete sender own message while setting deletedAt and updatedAt', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Secret text');
    const deleted = await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);

    expect(deleted.id).toBe(sent.id);
    expect(deleted.senderId).toBe(FIXTURE_USER_A.id);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
    expect(deleted.deletedAt).toBeDefined();
    expect(deleted.updatedAt).toBeDefined();
  });

  // Bonus Test 25: Delete another user's message
  it('25. should forbid deleting a message sent by another user', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Protected');

    await expect(messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_B.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  // Bonus Test 26: Delete nonexistent message
  it('26. should reject deleting a nonexistent message with NotFoundError', async () => {
    await expect(
      messageService.deleteMessage(chatId, 'nonexistent-msg', FIXTURE_USER_A.id),
    ).rejects.toThrow(NotFoundError);
  });

  // Bonus Test 27: Delete the same message twice
  it('27. should handle deleting the same message twice consistently without mutating deletedAt', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Delete twice');
    const firstDelete = await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);
    const secondDelete = await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);

    expect(secondDelete.isDeleted).toBe(true);
    expect(secondDelete.deletedAt).toBe(firstDelete.deletedAt);
    expect(secondDelete.updatedAt).toBe(firstDelete.updatedAt);
    expect(secondDelete.createdAt).toBe(firstDelete.createdAt);
  });

  // Bonus Test 28: Verify deleted message content is not exposed
  it('28. should mask deleted message content in message retrieval', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Top secret string');
    await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);

    const list = await messageService.getMessages(chatId, 50, undefined, FIXTURE_USER_B.id);
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0].text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
    expect(list.messages[0].text).not.toContain('Top secret string');
    expect(list.messages[0].isDeleted).toBe(true);
    expect(list.messages[0].deletedAt).toBeDefined();
  });

  // Bonus Test 29: Verify read receipts are preserved after edit and delete
  it('29. should preserve existing read receipts across edits and soft deletion', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Hello Bob');
    const originalReadAt = store.seedReadReceipt(chatId, sent.id, FIXTURE_USER_B.id);

    await messageService.editMessage(chatId, sent.id, FIXTURE_USER_A.id, 'Hello Bob edited');
    expect(store.getReadReceipt(chatId, sent.id, FIXTURE_USER_B.id)?.readAt).toEqual(
      originalReadAt,
    );

    await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);
    expect(store.getReadReceipt(chatId, sent.id, FIXTURE_USER_B.id)?.readAt).toEqual(
      originalReadAt,
    );
  });

  // Bonus Test 30: Verify original createdAt remains unchanged
  it('30. should preserve original createdAt across both edit and soft delete', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Initial');
    const initial = await messageService.getMessageById(chatId, sent.id);

    const edited = await messageService.editMessage(
      chatId,
      sent.id,
      FIXTURE_USER_A.id,
      'Edited once',
    );
    expect(edited.createdAt).toBe(initial?.createdAt);

    const deleted = await messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id);
    expect(deleted.createdAt).toBe(initial?.createdAt);
  });

  // Bonus Test 31: Verify message ordering and pagination remain unchanged
  it('31. should preserve chronological message ordering and pagination when editing/deleting', async () => {
    const m1 = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'First');
    const m2 = await messageService.sendMessage(chatId, FIXTURE_USER_B.id, 'Second');
    const m3 = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Third');

    await messageService.deleteMessage(chatId, m1.id, FIXTURE_USER_A.id);
    await messageService.editMessage(chatId, m2.id, FIXTURE_USER_B.id, 'Second (edited)');

    const page1 = await messageService.getMessages(chatId, 2, undefined, FIXTURE_USER_A.id);
    expect(page1.messages.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(page1.messages[0].isDeleted).toBe(true);
    expect(page1.messages[0].text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
    expect(page1.messages[1].text).toBe('Second (edited)');
    expect(page1.hasMore).toBe(true);

    const page2 = await messageService.getMessages(chatId, 2, page1.nextCursor!, FIXTURE_USER_A.id);
    expect(page2.messages.map((m) => m.id)).toEqual([m3.id]);
    expect(page2.hasMore).toBe(false);
  });

  // Bonus Test 32: Concurrent edit/delete requests
  it('32. should safely serialize concurrent edit and delete requests via Firestore transaction', async () => {
    const sent = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Concurrent target');

    // Delete first in promise order, edit immediately concurrently
    const [deleteRes, editRes] = await Promise.allSettled([
      messageService.deleteMessage(chatId, sent.id, FIXTURE_USER_A.id),
      messageService.editMessage(chatId, sent.id, FIXTURE_USER_A.id, 'Concurrent edit'),
    ]);

    expect(deleteRes.status).toBe('fulfilled');
    expect(editRes.status).toBe('rejected');
    if (editRes.status === 'rejected') {
      expect(editRes.reason).toBeInstanceOf(BadRequestError);
    }

    const finalMsg = await messageService.getMessageById(chatId, sent.id);
    expect(finalMsg?.isDeleted).toBe(true);
    expect(finalMsg?.text).toBe(MESSAGE_CONSTANTS.DELETED_PLACEHOLDER);
  });

  it('should forbid a removed member from editing or deleting messages', async () => {
    mockChatService.verifyMembership.mockRejectedValue(
      new ForbiddenError('You are not an authorized member of this chat'),
    );

    await expect(
      messageService.editMessage(chatId, 'msg-1', FIXTURE_USER_A.id, 'Edit'),
    ).rejects.toThrow(ForbiddenError);
    await expect(messageService.deleteMessage(chatId, 'msg-1', FIXTURE_USER_A.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
