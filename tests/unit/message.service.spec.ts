import { MessageService } from '../../src/modules/message/message.service';
import { MessageRepository } from '../../src/modules/message/message.repository';
import { ChatService } from '../../src/modules/chat/chat.service';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../src/common/errors';
import { FIXTURE_USER_A, FIXTURE_USER_B, FIXTURE_USER_C } from '../fixtures/test-data';
import { Chat } from '../../src/entities/Chat.entity';
import { encodeCursor } from '../../src/common/utils';

describe('MessageService - Unit Tests (Edge Cases 7 - 22)', () => {
  let messageService: MessageService;
  let mockMessageRepo: jest.Mocked<MessageRepository>;
  let mockChatService: jest.Mocked<ChatService>;
  const chatId = 'chat-uuid-0001';

  beforeEach(() => {
    mockMessageRepo = {
      createMessage: jest.fn(),
      findMessageById: jest.fn(),
      getMessages: jest.fn(),
    } as unknown as jest.Mocked<MessageRepository>;

    mockChatService = {
      getChatById: jest.fn(),
      verifyMembership: jest.fn(),
      recordActivity: jest.fn(),
    } as unknown as jest.Mocked<ChatService>;

    messageService = new MessageService(mockMessageRepo, mockChatService);
  });

  // Edge Case 7: Successful message sending
  it('7. should successfully send a message and record chat activity', async () => {
    const serverCreatedAt = '2026-11-26T17:34:19.831Z';
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.createMessage.mockResolvedValue({
      id: 'msg-1',
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Hello world',
      createdAt: serverCreatedAt,
      updatedAt: serverCreatedAt,
    });

    const result = await messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Hello world');

    expect(result.id).toBe('msg-1');
    expect(result.text).toBe('Hello world');
    expect(mockChatService.verifyMembership).toHaveBeenCalledWith(chatId, FIXTURE_USER_A.id);
    expect(mockMessageRepo.createMessage).toHaveBeenCalledWith(
      chatId,
      FIXTURE_USER_A.id,
      'Hello world',
    );
    expect(mockChatService.recordActivity).toHaveBeenCalledWith(chatId, new Date(serverCreatedAt));
  });

  // Edge Case 8: Nonexistent chat
  it('8. should reject sending message if chat does not exist', async () => {
    mockChatService.verifyMembership.mockRejectedValue(
      new NotFoundError(`Chat with id "${chatId}" not found`),
    );

    await expect(messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Hello')).rejects.toThrow(
      NotFoundError,
    );

    expect(mockMessageRepo.createMessage).not.toHaveBeenCalled();
  });

  // Edge Case 9: Non-member sender
  it('9. should reject message send if sender is not a member of the chat', async () => {
    mockChatService.verifyMembership.mockRejectedValue(
      new ForbiddenError('You are not an authorized member of this chat'),
    );

    await expect(
      messageService.sendMessage(chatId, FIXTURE_USER_C.id, 'Hello unauthorized'),
    ).rejects.toThrow(ForbiddenError);

    expect(mockMessageRepo.createMessage).not.toHaveBeenCalled();
  });

  // Edge Case 10: Empty message
  it('10. should reject empty message string', async () => {
    await expect(messageService.sendMessage(chatId, FIXTURE_USER_A.id, '')).rejects.toThrow(
      BadRequestError,
    );

    expect(mockChatService.verifyMembership).not.toHaveBeenCalled();
    expect(mockMessageRepo.createMessage).not.toHaveBeenCalled();
  });

  // Edge Case 11: Whitespace-only message
  it('11. should reject whitespace-only message string', async () => {
    await expect(
      messageService.sendMessage(chatId, FIXTURE_USER_A.id, '    \n  \t  '),
    ).rejects.toThrow(BadRequestError);

    expect(mockChatService.verifyMembership).not.toHaveBeenCalled();
    expect(mockMessageRepo.createMessage).not.toHaveBeenCalled();
  });

  // Edge Case 12: Exceeding message-length limit
  it('12. should reject message exceeding max length (2000 chars)', async () => {
    const oversizedText = 'a'.repeat(2001);

    await expect(
      messageService.sendMessage(chatId, FIXTURE_USER_A.id, oversizedText),
    ).rejects.toThrow(BadRequestError);

    expect(mockChatService.verifyMembership).not.toHaveBeenCalled();
  });

  // Edge Case 13: Firestore unavailable
  it('13. should handle Firestore unavailable error gracefully', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.createMessage.mockRejectedValue(
      new ServiceUnavailableError('Firestore is currently unreachable'),
    );

    await expect(
      messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Valid message'),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  // Edge Case 14: Concurrent message sending
  it('14. should handle concurrent message sends from multiple members independently', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.createMessage
      .mockResolvedValueOnce({
        id: 'msg-c1',
        chatId,
        senderId: FIXTURE_USER_A.id,
        text: 'Msg 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'msg-c2',
        chatId,
        senderId: FIXTURE_USER_B.id,
        text: 'Msg 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    const [res1, res2] = await Promise.all([
      messageService.sendMessage(chatId, FIXTURE_USER_A.id, 'Msg 1'),
      messageService.sendMessage(chatId, FIXTURE_USER_B.id, 'Msg 2'),
    ]);

    expect(res1.id).toBe('msg-c1');
    expect(res2.id).toBe('msg-c2');
  });

  // Edge Case 15: Empty chat
  it('15. should return empty array and null nextCursor for empty chat', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages.mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false,
    });

    const result = await messageService.getMessages(chatId, 50, undefined, FIXTURE_USER_A.id);

    expect(result.messages).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
    expect(mockChatService.verifyMembership).toHaveBeenCalledWith(chatId, FIXTURE_USER_A.id);
  });

  // Edge Case 16: Correct chronological order
  it('16. should return messages in chronological order', async () => {
    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-01T10:01:00.000Z';
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          chatId,
          senderId: FIXTURE_USER_A.id,
          text: 'First',
          createdAt: t1,
          updatedAt: t1,
        },
        {
          id: 'm2',
          chatId,
          senderId: FIXTURE_USER_B.id,
          text: 'Second',
          createdAt: t2,
          updatedAt: t2,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const result = await messageService.getMessages(chatId, 50, undefined, FIXTURE_USER_A.id);

    expect(result.messages[0].id).toBe('m1');
    expect(result.messages[1].id).toBe('m2');
    expect(new Date(result.messages[0].createdAt).getTime()).toBeLessThan(
      new Date(result.messages[1].createdAt).getTime(),
    );
  });

  // Edge Case 17: Pagination
  it('17. should return nextCursor when additional messages exist', async () => {
    const nextCursorVal = encodeCursor(1700000000000, 'msg-50');
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          chatId,
          senderId: FIXTURE_USER_A.id,
          text: 'Text',
          createdAt: '',
          updatedAt: '',
        },
      ],
      nextCursor: nextCursorVal,
      hasMore: true,
    });

    const result = await messageService.getMessages(chatId, 1, undefined, FIXTURE_USER_A.id);

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(nextCursorVal);
  });

  // Edge Case 18: Invalid limit (handled by Joi in HTTP layer; service accepts valid positive integer)
  it('18. should pass valid limit to repository', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages.mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false,
    });

    await messageService.getMessages(chatId, 25, undefined, FIXTURE_USER_A.id);
    expect(mockMessageRepo.getMessages).toHaveBeenCalledWith(chatId, 25, undefined);
  });

  // Edge Case 19: Invalid cursor
  it('19. should throw BadRequestError when cursor format is corrupted or invalid', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);

    await expect(
      messageService.getMessages(chatId, 50, 'corrupted-base64-string!@#$', FIXTURE_USER_A.id),
    ).rejects.toThrow(BadRequestError);

    expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
  });

  // Edge Case 20: Non-member access
  it('20. should reject getMessages if requester is not a member of the chat', async () => {
    mockChatService.getChatById.mockResolvedValue(new Chat());
    mockChatService.verifyMembership.mockRejectedValue(
      new ForbiddenError('You are not an authorized member of this chat'),
    );

    await expect(
      messageService.getMessages(chatId, 50, undefined, FIXTURE_USER_C.id),
    ).rejects.toThrow(ForbiddenError);

    expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
  });

  it('should reject getMessages with UnauthorizedError when requester identity is omitted', async () => {
    await expect(messageService.getMessages(chatId, 50)).rejects.toThrow(UnauthorizedError);
    expect(mockChatService.verifyMembership).not.toHaveBeenCalled();
    expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
  });

  // Edge Case 21: Equal timestamps with stable ordering
  it('21. should maintain deterministic stable ordering for identical timestamps using messageId tie-breaker', async () => {
    const identicalTime = '2026-01-01T12:00:00.000Z';
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages.mockResolvedValue({
      messages: [
        {
          id: 'msg-aaa',
          chatId,
          senderId: FIXTURE_USER_A.id,
          text: 'A',
          createdAt: identicalTime,
          updatedAt: identicalTime,
        },
        {
          id: 'msg-bbb',
          chatId,
          senderId: FIXTURE_USER_B.id,
          text: 'B',
          createdAt: identicalTime,
          updatedAt: identicalTime,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const result = await messageService.getMessages(chatId, 10, undefined, FIXTURE_USER_A.id);
    expect(result.messages[0].id).toBe('msg-aaa');
    expect(result.messages[1].id).toBe('msg-bbb');
  });

  // Edge Case 22: No duplicate messages across pages
  it('22. should not produce duplicate messages across consecutive paginated requests', async () => {
    const page1Msg = {
      id: 'm1',
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'P1',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '',
    };
    const page2Msg = {
      id: 'm2',
      chatId,
      senderId: FIXTURE_USER_B.id,
      text: 'P2',
      createdAt: '2026-01-01T10:01:00.000Z',
      updatedAt: '',
    };

    const cursorP1 = encodeCursor(1000, 'm1');

    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageRepo.getMessages
      .mockResolvedValueOnce({ messages: [page1Msg], nextCursor: cursorP1, hasMore: true })
      .mockResolvedValueOnce({ messages: [page2Msg], nextCursor: null, hasMore: false });

    const page1 = await messageService.getMessages(chatId, 1, undefined, FIXTURE_USER_A.id);
    const page2 = await messageService.getMessages(chatId, 1, page1.nextCursor!, FIXTURE_USER_A.id);

    const combinedIds = [...page1.messages, ...page2.messages].map((m) => m.id);
    const uniqueIds = Array.from(new Set(combinedIds));

    expect(combinedIds).toEqual(uniqueIds);
    expect(uniqueIds).toEqual(['m1', 'm2']);
  });
});
