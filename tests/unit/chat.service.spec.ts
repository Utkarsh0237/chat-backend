import { ChatService } from '../../src/modules/chat/chat.service';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { UserService } from '../../src/modules/user/user.service';
import { BadRequestError, NotFoundError } from '../../src/common/errors';
import { Chat } from '../../src/entities/Chat.entity';
import { User } from '../../src/entities/User.entity';
import { FIXTURE_USER_A, FIXTURE_USER_B, NONEXISTENT_UUID } from '../fixtures/test-data';

describe('ChatService - Unit Tests (Edge Cases 1 - 6)', () => {
  let chatService: ChatService;
  let mockChatRepo: jest.Mocked<ChatRepository>;
  let mockUserService: jest.Mocked<UserService>;

  beforeEach(() => {
    mockChatRepo = {
      findById: jest.fn(),
      findByCanonicalParticipants: jest.fn(),
      findUserChats: jest.fn(),
      isUserMember: jest.fn(),
      updateLastActivity: jest.fn(),
      createDirectChatWithTransaction: jest.fn(),
    } as unknown as jest.Mocked<ChatRepository>;

    mockUserService = {
      createUser: jest.fn(),
      getUserById: jest.fn(),
      validateUsersExist: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    chatService = new ChatService(mockChatRepo, mockUserService);
  });

  // Edge Case 1: Successful chat creation
  it('1. should successfully create a new direct chat when none exists', async () => {
    const fakeChat = new Chat();
    fakeChat.id = 'chat-new-1';

    mockUserService.validateUsersExist.mockResolvedValue([
      FIXTURE_USER_A as User,
      FIXTURE_USER_B as User,
    ]);
    mockChatRepo.createDirectChatWithTransaction.mockResolvedValue({
      chat: fakeChat,
      isNew: true,
    });

    const result = await chatService.createOrGetDirectChat(FIXTURE_USER_A.id, FIXTURE_USER_B.id);

    expect(result).toEqual({ chatId: 'chat-new-1', isNew: true });
    expect(mockUserService.validateUsersExist).toHaveBeenCalledWith(
      FIXTURE_USER_A.id,
      FIXTURE_USER_B.id,
    );
    expect(mockChatRepo.createDirectChatWithTransaction).toHaveBeenCalled();
  });

  // Edge Case 2: Existing chat retrieval
  it('2. should return existing chat if already created between the two users', async () => {
    const existingChat = new Chat();
    existingChat.id = 'chat-existing-1';

    mockUserService.validateUsersExist.mockResolvedValue([
      FIXTURE_USER_A as User,
      FIXTURE_USER_B as User,
    ]);
    mockChatRepo.createDirectChatWithTransaction.mockResolvedValue({
      chat: existingChat,
      isNew: false,
    });

    const result = await chatService.createOrGetDirectChat(FIXTURE_USER_A.id, FIXTURE_USER_B.id);

    expect(result).toEqual({ chatId: 'chat-existing-1', isNew: false });
  });

  // Edge Case 3: Identical user IDs
  it('3. should reject chat creation when userAId and userBId are identical', async () => {
    await expect(
      chatService.createOrGetDirectChat(FIXTURE_USER_A.id, FIXTURE_USER_A.id),
    ).rejects.toThrow(BadRequestError);

    expect(mockUserService.validateUsersExist).not.toHaveBeenCalled();
    expect(mockChatRepo.createDirectChatWithTransaction).not.toHaveBeenCalled();
  });

  // Edge Case 4: Nonexistent users
  it('4. should reject chat creation when one or both users do not exist', async () => {
    mockUserService.validateUsersExist.mockRejectedValue(
      new NotFoundError(`User with id "${NONEXISTENT_UUID}" does not exist`),
    );

    await expect(
      chatService.createOrGetDirectChat(FIXTURE_USER_A.id, NONEXISTENT_UUID),
    ).rejects.toThrow(NotFoundError);

    expect(mockChatRepo.createDirectChatWithTransaction).not.toHaveBeenCalled();
  });

  // Edge Case 5: Concurrent chat creation
  it('5. should safely resolve concurrent chat creation race condition and return existing chat', async () => {
    const existingChat = new Chat();
    existingChat.id = 'chat-race-won-1';

    mockUserService.validateUsersExist.mockResolvedValue([
      FIXTURE_USER_A as User,
      FIXTURE_USER_B as User,
    ]);
    // The repo handles 23505 conflict and returns the existing chat
    mockChatRepo.createDirectChatWithTransaction.mockResolvedValue({
      chat: existingChat,
      isNew: false,
    });

    const result = await chatService.createOrGetDirectChat(FIXTURE_USER_A.id, FIXTURE_USER_B.id);

    expect(result).toEqual({ chatId: 'chat-race-won-1', isNew: false });
  });

  // Edge Case 6: Database failure
  it('6. should propagate database failure when connection drops during chat creation', async () => {
    mockUserService.validateUsersExist.mockResolvedValue([
      FIXTURE_USER_A as User,
      FIXTURE_USER_B as User,
    ]);
    mockChatRepo.createDirectChatWithTransaction.mockRejectedValue(
      new Error('Database connection lost'),
    );

    await expect(
      chatService.createOrGetDirectChat(FIXTURE_USER_A.id, FIXTURE_USER_B.id),
    ).rejects.toThrow('Database connection lost');
  });
});
