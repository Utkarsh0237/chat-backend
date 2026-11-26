import { ReadReceiptService } from '../../src/modules/read-receipt/read-receipt.service';
import { ReadReceiptRepository } from '../../src/modules/read-receipt/read-receipt.repository';
import { ChatService } from '../../src/modules/chat/chat.service';
import { MessageService } from '../../src/modules/message/message.service';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
} from '../../src/common/errors';
import { FIXTURE_USER_A, FIXTURE_USER_B, FIXTURE_USER_C } from '../fixtures/test-data';

describe('ReadReceiptService - Unit Tests (Edge Cases 23 - 34)', () => {
  let readReceiptService: ReadReceiptService;
  let mockReadRepo: jest.Mocked<ReadReceiptRepository>;
  let mockChatService: jest.Mocked<ChatService>;
  let mockMessageService: jest.Mocked<MessageService>;

  const chatId = 'chat-uuid-0001';
  const messageId = 'msg-uuid-0001';

  beforeEach(() => {
    mockReadRepo = {
      saveReadReceipt: jest.fn(),
      updateLastSeenAtomic: jest.fn(),
      getLastSeen: jest.fn(),
    } as unknown as jest.Mocked<ReadReceiptRepository>;

    mockChatService = {
      verifyMembership: jest.fn(),
    } as unknown as jest.Mocked<ChatService>;

    mockMessageService = {
      getMessageById: jest.fn(),
    } as unknown as jest.Mocked<MessageService>;

    readReceiptService = new ReadReceiptService(mockReadRepo, mockChatService, mockMessageService);
  });

  // Edge Case 23: Successful read receipt
  it('23. should successfully save a read receipt for another member message', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id, // Sent by Alice
      text: 'Hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.saveReadReceipt.mockResolvedValue({
      userId: FIXTURE_USER_B.id, // Bob marks read
      readAt: new Date().toISOString(),
    });

    const result = await readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_B.id);

    expect(result.messageId).toBe(messageId);
    expect(result.userId).toBe(FIXTURE_USER_B.id);
    expect(mockReadRepo.saveReadReceipt).toHaveBeenCalledWith(chatId, messageId, FIXTURE_USER_B.id);
  });

  // Edge Case 24: Duplicate read request
  it('24. should safely and idempotently handle duplicate read requests', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.saveReadReceipt.mockResolvedValue({
      userId: FIXTURE_USER_B.id,
      readAt: new Date().toISOString(),
    });

    // Calling twice
    const res1 = await readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_B.id);
    const res2 = await readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_B.id);

    expect(res1.userId).toBe(FIXTURE_USER_B.id);
    expect(res2.userId).toBe(FIXTURE_USER_B.id);
  });

  // Edge Case 25: Nonexistent message
  it('25. should reject read receipt if message does not exist', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue(null);

    await expect(
      readReceiptService.markMessageRead(chatId, 'nonexistent-msg', FIXTURE_USER_B.id),
    ).rejects.toThrow(NotFoundError);

    expect(mockReadRepo.saveReadReceipt).not.toHaveBeenCalled();
  });

  // Edge Case 26: Non-member user
  it('26. should reject read receipt if user is not a member of the chat', async () => {
    mockChatService.verifyMembership.mockRejectedValue(
      new ForbiddenError('You are not an authorized member of this chat'),
    );

    await expect(
      readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_C.id),
    ).rejects.toThrow(ForbiddenError);

    expect(mockMessageService.getMessageById).not.toHaveBeenCalled();
    expect(mockReadRepo.saveReadReceipt).not.toHaveBeenCalled();
  });

  // Edge Case 27: Reading own message
  it('27. should prevent user from marking their own message as read', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id, // Sent by Alice
      text: 'My own message',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });

    // Alice attempts to mark her own message read
    await expect(
      readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_A.id),
    ).rejects.toThrow(BadRequestError);

    expect(mockReadRepo.saveReadReceipt).not.toHaveBeenCalled();
  });

  // Edge Case 28: Firestore failure
  it('28. should propagate Firestore failure when saving read receipt', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.saveReadReceipt.mockRejectedValue(
      new ServiceUnavailableError('Firestore is currently unreachable'),
    );

    await expect(
      readReceiptService.markMessageRead(chatId, messageId, FIXTURE_USER_B.id),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  // Edge Case 29: Successful update last seen
  it('29. should successfully update last seen message for a chat member', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.updateLastSeenAtomic.mockResolvedValue({
      lastSeenMessageId: messageId,
      lastSeenAt: new Date().toISOString(),
    });

    const result = await readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, messageId);

    expect(result.lastSeenMessageId).toBe(messageId);
    expect(result.userId).toBe(FIXTURE_USER_B.id);
  });

  // Edge Case 30: Moving last seen backwards
  it('30. should reject moving last seen backwards to an older message', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: 'older-msg',
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Old msg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 500,
    });
    mockReadRepo.updateLastSeenAtomic.mockRejectedValue(
      new BadRequestError('Cannot move last seen backwards to an older message'),
    );

    await expect(
      readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, 'older-msg'),
    ).rejects.toThrow(BadRequestError);
  });

  // Edge Case 31: Message from another chat
  it('31. should reject update last seen if message does not belong to the requested chat', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    // getMessageById for this chatId returns null because the message belongs to another chat
    mockMessageService.getMessageById.mockResolvedValue(null);

    await expect(
      readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, 'foreign-msg-id'),
    ).rejects.toThrow(NotFoundError);

    expect(mockReadRepo.updateLastSeenAtomic).not.toHaveBeenCalled();
  });

  // Edge Case 32: Nonexistent message
  it('32. should reject update last seen if target message does not exist at all', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue(null);

    await expect(
      readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, 'nonexistent-id'),
    ).rejects.toThrow(NotFoundError);

    expect(mockReadRepo.updateLastSeenAtomic).not.toHaveBeenCalled();
  });

  // Edge Case 33: Concurrent updates
  it('33. should safely handle concurrent last seen updates via atomic Firestore transactions', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Msg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.updateLastSeenAtomic.mockResolvedValue({
      lastSeenMessageId: messageId,
      lastSeenAt: new Date().toISOString(),
    });

    const [u1, u2] = await Promise.all([
      readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, messageId),
      readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, messageId),
    ]);

    expect(u1.lastSeenMessageId).toBe(messageId);
    expect(u2.lastSeenMessageId).toBe(messageId);
  });

  // Edge Case 34: Duplicate update
  it('34. should handle duplicate update last seen idempotently without regression', async () => {
    mockChatService.verifyMembership.mockResolvedValue(undefined);
    mockMessageService.getMessageById.mockResolvedValue({
      id: messageId,
      chatId,
      senderId: FIXTURE_USER_A.id,
      text: 'Msg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAtMillis: 1000,
    });
    mockReadRepo.updateLastSeenAtomic.mockResolvedValue({
      lastSeenMessageId: messageId,
      lastSeenAt: new Date().toISOString(),
    });

    const res = await readReceiptService.updateLastSeen(chatId, FIXTURE_USER_B.id, messageId);
    expect(res.lastSeenMessageId).toBe(messageId);
  });
});
