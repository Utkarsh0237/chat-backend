import * as admin from 'firebase-admin';
import { DataSource } from 'typeorm';
import { Chat } from '../../src/entities/Chat.entity';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { ChatService } from '../../src/modules/chat/chat.service';
import { MessageRepository } from '../../src/modules/message/message.repository';
import { MessageService } from '../../src/modules/message/message.service';
import { UserService } from '../../src/modules/user/user.service';
import { FIXTURE_USER_A, FIXTURE_USER_B } from '../fixtures/test-data';

describe('Message Timestamp & Chat lastActivityAt Consistency - Unit Tests', () => {
  const chatId = 'chat-sync-0001';

  it('should read back authoritative Firestore serverTimestamp in MessageRepository.createMessage', async () => {
    const authoritativeServerDate = new Date('2026-11-26T18:00:00.835Z');
    const localTimeSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-11-26T18:00:00.761Z').getTime());

    let storedData: Record<string, unknown> | undefined;
    const mockDocRef = {
      id: 'msg-server-time-1',
      set: jest.fn(async (payload: Record<string, unknown>) => {
        // Simulate Firestore resolving FieldValue.serverTimestamp() later than local host clock
        storedData = {
          senderId: payload.senderId,
          text: payload.text,
          isDeleted: payload.isDeleted,
          createdAt: admin.firestore.Timestamp.fromDate(authoritativeServerDate),
          updatedAt: admin.firestore.Timestamp.fromDate(authoritativeServerDate),
        };
      }),
      get: jest.fn(async () => ({
        id: 'msg-server-time-1',
        exists: true,
        data: () => storedData,
      })),
    };

    const mockFirestore = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          collection: jest.fn().mockReturnValue({
            doc: jest.fn().mockReturnValue(mockDocRef),
          }),
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    try {
      const repo = new MessageRepository(mockFirestore);
      const saved = await repo.createMessage(chatId, FIXTURE_USER_A.id, 'Server clock check');

      expect(mockDocRef.set).toHaveBeenCalledTimes(1);
      expect(mockDocRef.get).toHaveBeenCalledTimes(1);
      expect(saved.createdAt).toBe(authoritativeServerDate.toISOString());
      expect(saved.updatedAt).toBe(authoritativeServerDate.toISOString());
    } finally {
      localTimeSpy.mockRestore();
    }
  });

  it('should fall back safely in MessageRepository.createMessage if snapshot returns no data', async () => {
    const mockDocRef = {
      id: 'msg-fallback-1',
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({
        id: 'msg-fallback-1',
        exists: false,
        data: () => undefined,
      }),
    };

    const mockFirestore = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          collection: jest.fn().mockReturnValue({
            doc: jest.fn().mockReturnValue(mockDocRef),
          }),
        }),
      }),
    } as unknown as admin.firestore.Firestore;

    const repo = new MessageRepository(mockFirestore);
    const saved = await repo.createMessage(chatId, FIXTURE_USER_A.id, 'Fallback test');

    expect(saved.id).toBe('msg-fallback-1');
    expect(Number.isNaN(new Date(saved.createdAt).getTime())).toBe(false);
  });

  it('should forward Firestore createdAt Date to ChatService.recordActivity from MessageService.sendMessage', async () => {
    const serverIso = '2026-11-26T18:10:05.835Z';
    const mockMessageRepo = {
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg-fwd-1',
        chatId,
        senderId: FIXTURE_USER_A.id,
        text: 'Timestamp forward',
        createdAt: serverIso,
        updatedAt: serverIso,
      }),
    } as unknown as jest.Mocked<MessageRepository>;

    const mockChatService = {
      verifyMembership: jest.fn().mockResolvedValue(undefined),
      recordActivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChatService>;

    const service = new MessageService(mockMessageRepo, mockChatService);
    await service.sendMessage(chatId, FIXTURE_USER_A.id, 'Timestamp forward');

    expect(mockChatService.recordActivity).toHaveBeenCalledWith(chatId, new Date(serverIso));
  });

  it('should fall back to current Date when MessageRepository mock yields non-date createdAt', async () => {
    const mockMessageRepo = {
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg-invalid-ts',
        chatId,
        senderId: FIXTURE_USER_A.id,
        text: 'Invalid ts',
        createdAt: '',
        updatedAt: '',
      }),
    } as unknown as jest.Mocked<MessageRepository>;

    const mockChatService = {
      verifyMembership: jest.fn().mockResolvedValue(undefined),
      recordActivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChatService>;

    const before = Date.now();
    const service = new MessageService(mockMessageRepo, mockChatService);
    await service.sendMessage(chatId, FIXTURE_USER_A.id, 'Invalid ts');
    const after = Date.now();

    const passedDate = mockChatService.recordActivity.mock.calls[0]?.[1];
    expect(passedDate).toBeInstanceOf(Date);
    expect(passedDate!.getTime()).toBeGreaterThanOrEqual(before);
    expect(passedDate!.getTime()).toBeLessThanOrEqual(after);
  });

  it('should execute an atomic monotonic QueryBuilder update in ChatRepository.updateLastActivity', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const andWhere = jest.fn().mockReturnValue({ execute });
    const where = jest.fn().mockReturnValue({ andWhere });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const createQueryBuilder = jest.fn().mockReturnValue({ update });

    const mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder,
      }),
    } as unknown as DataSource;

    const chatRepo = new ChatRepository(mockDataSource);
    const activityAt = new Date('2026-11-26T18:15:00.500Z');
    await chatRepo.updateLastActivity(chatId, activityAt);

    expect(update).toHaveBeenCalledWith(Chat);
    expect(set).toHaveBeenCalledWith({ lastActivityAt: activityAt });
    expect(where).toHaveBeenCalledWith('id = :chatId', { chatId });
    expect(andWhere).toHaveBeenCalledWith(
      '("lastActivityAt" IS NULL OR "lastActivityAt" < :activityDate)',
      { activityDate: activityAt },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('should prevent older concurrent message activity updates from overwriting a newer lastActivityAt', async () => {
    let persistedLastActivity = new Date('2026-11-26T18:20:00.000Z');

    // Stateful simulated QueryBuilder enforcing PostgreSQL predicate ("lastActivityAt" < :activityDate)
    const mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: () => {
          let nextDate: Date;
          let targetChatId = '';
          const qb = {
            update: () => qb,
            set: (vals: { lastActivityAt: Date }) => {
              nextDate = vals.lastActivityAt;
              return qb;
            },
            where: (_sql: string, params: { chatId: string }) => {
              targetChatId = params.chatId;
              return qb;
            },
            andWhere: () => qb,
            execute: async () => {
              if (targetChatId === chatId && persistedLastActivity < nextDate) {
                persistedLastActivity = nextDate;
                return { affected: 1 };
              }
              return { affected: 0 };
            },
          };
          return qb;
        },
      }),
    } as unknown as DataSource;

    const chatRepo = new ChatRepository(mockDataSource);
    const mockUserService = {} as unknown as UserService;
    const chatService = new ChatService(chatRepo, mockUserService);

    const tOlder = new Date('2026-11-26T18:20:01.100Z');
    const tNewer = new Date('2026-11-26T18:20:01.500Z');

    // Simulate Firestore committing tOlder BEFORE tNewer, yet Node receiving/updating tNewer first
    let callCount = 0;
    const mockMessageRepo = {
      createMessage: jest.fn(async (_cId: string, senderId: string, text: string) => {
        callCount += 1;
        const isFirstCall = callCount === 1;
        // First request gets earlier Firestore timestamp tOlder, but takes longer to return
        await new Promise((r) => setTimeout(r, isFirstCall ? 25 : 5));
        const ts = (isFirstCall ? tOlder : tNewer).toISOString();
        return {
          id: isFirstCall ? 'msg-older' : 'msg-newer',
          chatId,
          senderId,
          text,
          createdAt: ts,
          updatedAt: ts,
        };
      }),
    } as unknown as jest.Mocked<MessageRepository>;

    jest.spyOn(chatService, 'verifyMembership').mockResolvedValue(undefined);

    const messageService = new MessageService(mockMessageRepo, chatService);

    await Promise.all([
      messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Slow earlier message'),
      messageService.sendMessage(chatId, FIXTURE_USER_B.id, 'Fast newer message'),
    ]);

    // Even though slow earlier message's recordActivity executed last, lastActivityAt stayed at tNewer
    expect(persistedLastActivity.toISOString()).toBe(tNewer.toISOString());
  });
});
