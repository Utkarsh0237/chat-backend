import { ChatService } from '../../src/modules/chat/chat.service';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { UserService } from '../../src/modules/user/user.service';
import { NotFoundError } from '../../src/common/errors';
import { Chat } from '../../src/entities/Chat.entity';
import { ChatMember } from '../../src/entities/ChatMember.entity';
import {
  FIXTURE_USER_A,
  FIXTURE_USER_B,
  FIXTURE_USER_C,
  NONEXISTENT_UUID,
} from '../fixtures/test-data';

describe('UserChats - Unit Tests (Edge Cases 35 - 40)', () => {
  let chatService: ChatService;
  let mockChatRepo: jest.Mocked<ChatRepository>;
  let mockUserService: jest.Mocked<UserService>;

  beforeEach(() => {
    mockChatRepo = {
      findUserChats: jest.fn(),
      findById: jest.fn(),
      findByCanonicalParticipants: jest.fn(),
      isUserMember: jest.fn(),
      updateLastActivity: jest.fn(),
      createDirectChatWithTransaction: jest.fn(),
    } as unknown as jest.Mocked<ChatRepository>;

    mockUserService = {
      getUserById: jest.fn(),
      validateUsersExist: jest.fn(),
      createUser: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    chatService = new ChatService(mockChatRepo, mockUserService);
  });

  // Edge Case 35: User with multiple chats
  it('35. should return all chats belonging to a user with multiple chats', async () => {
    const chat1 = new Chat();
    chat1.id = 'chat-1';
    chat1.type = 'DIRECT';
    chat1.lastActivityAt = new Date('2026-01-02T10:00:00Z');
    chat1.createdAt = new Date('2026-01-01T10:00:00Z');
    chat1.updatedAt = new Date('2026-01-02T10:00:00Z');
    chat1.members = [
      { userId: FIXTURE_USER_A.id } as ChatMember,
      { userId: FIXTURE_USER_B.id } as ChatMember,
    ];

    const chat2 = new Chat();
    chat2.id = 'chat-2';
    chat2.type = 'DIRECT';
    chat2.lastActivityAt = new Date('2026-01-01T15:00:00Z');
    chat2.createdAt = new Date('2026-01-01T12:00:00Z');
    chat2.updatedAt = new Date('2026-01-01T15:00:00Z');
    chat2.members = [
      { userId: FIXTURE_USER_A.id } as ChatMember,
      { userId: FIXTURE_USER_C.id } as ChatMember,
    ];

    mockUserService.getUserById.mockResolvedValue({ id: FIXTURE_USER_A.id } as never);
    mockChatRepo.findUserChats.mockResolvedValue([chat1, chat2]);

    const result = await chatService.listUserChats(FIXTURE_USER_A.id);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('chat-1');
    expect(result[1].id).toBe('chat-2');
  });

  // Edge Case 36: User with no chats
  it('36. should return empty array when user exists but has no chats', async () => {
    mockUserService.getUserById.mockResolvedValue({ id: FIXTURE_USER_A.id } as never);
    mockChatRepo.findUserChats.mockResolvedValue([]);

    const result = await chatService.listUserChats(FIXTURE_USER_A.id);

    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  // Edge Case 37: Nonexistent user
  it('37. should throw NotFoundError when fetching chats for nonexistent user', async () => {
    mockUserService.getUserById.mockRejectedValue(
      new NotFoundError(`User with id "${NONEXISTENT_UUID}" not found`),
    );

    await expect(chatService.listUserChats(NONEXISTENT_UUID)).rejects.toThrow(NotFoundError);
    expect(mockChatRepo.findUserChats).not.toHaveBeenCalled();
  });

  // Edge Case 38: Correct member IDs
  it('38. should correctly extract and return all member IDs for each chat', async () => {
    const chat = new Chat();
    chat.id = 'chat-1';
    chat.type = 'DIRECT';
    chat.lastActivityAt = new Date();
    chat.createdAt = new Date();
    chat.updatedAt = new Date();
    chat.members = [
      { userId: FIXTURE_USER_A.id } as ChatMember,
      { userId: FIXTURE_USER_B.id } as ChatMember,
    ];

    mockUserService.getUserById.mockResolvedValue({ id: FIXTURE_USER_A.id } as never);
    mockChatRepo.findUserChats.mockResolvedValue([chat]);

    const result = await chatService.listUserChats(FIXTURE_USER_A.id);

    expect(result[0].memberIds).toContain(FIXTURE_USER_A.id);
    expect(result[0].memberIds).toContain(FIXTURE_USER_B.id);
    expect(result[0].memberIds).toHaveLength(2);
  });

  // Edge Case 39: Correct ordering
  it('39. should return chats ordered by latest activity descending', async () => {
    const moreRecentChat = new Chat();
    moreRecentChat.id = 'chat-recent';
    moreRecentChat.type = 'DIRECT';
    moreRecentChat.lastActivityAt = new Date('2026-02-01T12:00:00Z');
    moreRecentChat.createdAt = new Date('2026-01-01T10:00:00Z');
    moreRecentChat.updatedAt = new Date('2026-02-01T12:00:00Z');
    moreRecentChat.members = [{ userId: FIXTURE_USER_A.id } as ChatMember];

    const olderChat = new Chat();
    olderChat.id = 'chat-older';
    olderChat.type = 'DIRECT';
    olderChat.lastActivityAt = new Date('2026-01-05T12:00:00Z');
    olderChat.createdAt = new Date('2026-01-01T10:00:00Z');
    olderChat.updatedAt = new Date('2026-01-05T12:00:00Z');
    olderChat.members = [{ userId: FIXTURE_USER_A.id } as ChatMember];

    mockUserService.getUserById.mockResolvedValue({ id: FIXTURE_USER_A.id } as never);
    // Repository queries with ORDER BY chat.lastActivityAt DESC
    mockChatRepo.findUserChats.mockResolvedValue([moreRecentChat, olderChat]);

    const result = await chatService.listUserChats(FIXTURE_USER_A.id);

    expect(result[0].id).toBe('chat-recent');
    expect(result[1].id).toBe('chat-older');
    expect(new Date(result[0].lastActivityAt).getTime()).toBeGreaterThan(
      new Date(result[1].lastActivityAt).getTime(),
    );
  });

  // Edge Case 40: Database failure
  it('40. should propagate database failure when fetching user chats', async () => {
    mockUserService.getUserById.mockResolvedValue({ id: FIXTURE_USER_A.id } as never);
    mockChatRepo.findUserChats.mockRejectedValue(new Error('PostgreSQL query execution failed'));

    await expect(chatService.listUserChats(FIXTURE_USER_A.id)).rejects.toThrow(
      'PostgreSQL query execution failed',
    );
  });
});
