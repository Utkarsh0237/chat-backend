import { ChatService } from '../../src/modules/chat/chat.service';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { UserService } from '../../src/modules/user/user.service';
import { MessageService } from '../../src/modules/message/message.service';
import { MessageRepository } from '../../src/modules/message/message.repository';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../src/common/errors';
import { ChatMemberRole, ChatType } from '../../src/common/constants';
import { Chat } from '../../src/entities/Chat.entity';
import { ChatMember } from '../../src/entities/ChatMember.entity';
import { User } from '../../src/entities/User.entity';
import {
  FIXTURE_USER_A,
  FIXTURE_USER_B,
  FIXTURE_USER_C,
  FIXTURE_USER_D,
  NONEXISTENT_UUID,
} from '../fixtures/test-data';

function makeMember(chatId: string, userId: string, role: ChatMemberRole): ChatMember {
  const m = new ChatMember();
  m.id = `cm-${userId}`;
  m.chatId = chatId;
  m.userId = userId;
  m.role = role;
  m.joinedAt = new Date('2026-01-01T10:00:00Z');
  return m;
}

function makeGroupChat(id: string, name: string, createdBy: string, members: ChatMember[]): Chat {
  const chat = new Chat();
  chat.id = id;
  chat.type = ChatType.GROUP;
  chat.name = name;
  chat.createdBy = createdBy;
  chat.canonicalParticipants = null;
  chat.lastActivityAt = new Date('2026-01-01T10:00:00Z');
  chat.createdAt = new Date('2026-01-01T10:00:00Z');
  chat.updatedAt = new Date('2026-01-01T10:00:00Z');
  chat.members = members;
  return chat;
}

describe('Group Chat - Unit Tests (Bonus Tests 1 - 17)', () => {
  let chatService: ChatService;
  let mockChatRepo: jest.Mocked<ChatRepository>;
  let mockUserService: jest.Mocked<UserService>;
  const groupId = 'group-uuid-0001';

  beforeEach(() => {
    mockChatRepo = {
      findById: jest.fn(),
      findByCanonicalParticipants: jest.fn(),
      findUserChats: jest.fn(),
      isUserMember: jest.fn(),
      updateLastActivity: jest.fn(),
      createDirectChatWithTransaction: jest.fn(),
      createGroupChatWithTransaction: jest.fn(),
      addGroupMembersWithTransaction: jest.fn(),
      removeGroupMemberWithTransaction: jest.fn(),
      updateGroupWithTransaction: jest.fn(),
    } as unknown as jest.Mocked<ChatRepository>;

    mockUserService = {
      createUser: jest.fn(),
      getUserById: jest.fn(),
      validateUsersExist: jest.fn(),
      validateUsersListExist: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    chatService = new ChatService(mockChatRepo, mockUserService);
  });

  // Bonus Test 1: Successfully create group
  it('1. should create a group chat with creator as ADMIN and specified members as MEMBER', async () => {
    const members = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
      makeMember(groupId, FIXTURE_USER_C.id, ChatMemberRole.MEMBER),
    ];
    mockUserService.validateUsersListExist.mockResolvedValue([
      FIXTURE_USER_A as User,
      FIXTURE_USER_B as User,
      FIXTURE_USER_C as User,
    ]);
    mockChatRepo.createGroupChatWithTransaction.mockResolvedValue(
      makeGroupChat(groupId, 'Development Team', FIXTURE_USER_A.id, members),
    );

    const res = await chatService.createGroupChat(FIXTURE_USER_A.id, '  Development Team  ', [
      FIXTURE_USER_B.id,
      FIXTURE_USER_C.id,
    ]);

    expect(res.id).toBe(groupId);
    expect(res.type).toBe(ChatType.GROUP);
    expect(res.name).toBe('Development Team');
    expect(res.createdBy).toBe(FIXTURE_USER_A.id);
    expect(res.members).toHaveLength(3);
    expect(res.members.find((m) => m.userId === FIXTURE_USER_A.id)?.role).toBe(
      ChatMemberRole.ADMIN,
    );
    expect(res.members.find((m) => m.userId === FIXTURE_USER_B.id)?.role).toBe(
      ChatMemberRole.MEMBER,
    );
    expect(mockChatRepo.createGroupChatWithTransaction).toHaveBeenCalledWith(
      FIXTURE_USER_A.id,
      'Development Team',
      [FIXTURE_USER_B.id, FIXTURE_USER_C.id],
    );
  });

  // Bonus Test 2: Nonexistent creator
  it('2. should reject group creation when creator does not exist', async () => {
    mockUserService.validateUsersListExist.mockRejectedValue(
      new NotFoundError(`User with id "${NONEXISTENT_UUID}" does not exist`),
    );

    await expect(
      chatService.createGroupChat(NONEXISTENT_UUID, 'Team', [FIXTURE_USER_B.id]),
    ).rejects.toThrow(NotFoundError);
    expect(mockChatRepo.createGroupChatWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Test 3: Nonexistent member
  it('3. should reject group creation when any supplied member does not exist', async () => {
    mockUserService.validateUsersListExist.mockRejectedValue(
      new NotFoundError(`User with id "${NONEXISTENT_UUID}" does not exist`),
    );

    await expect(
      chatService.createGroupChat(FIXTURE_USER_A.id, 'Team', [FIXTURE_USER_B.id, NONEXISTENT_UUID]),
    ).rejects.toThrow(NotFoundError);
    expect(mockChatRepo.createGroupChatWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Test 4: Creator omitted from memberIds is automatically included as ADMIN
  it('4. should automatically include creator as ADMIN when creator is omitted from memberIds', async () => {
    mockUserService.validateUsersListExist.mockResolvedValue([]);
    const members = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.createGroupChatWithTransaction.mockResolvedValue(
      makeGroupChat(groupId, 'Auto Include', FIXTURE_USER_A.id, members),
    );

    const res = await chatService.createGroupChat(FIXTURE_USER_A.id, 'Auto Include', [
      FIXTURE_USER_B.id,
    ]);

    expect(mockUserService.validateUsersListExist).toHaveBeenCalledWith([
      FIXTURE_USER_A.id,
      FIXTURE_USER_B.id,
    ]);
    expect(res.members.some((m) => m.userId === FIXTURE_USER_A.id)).toBe(true);
    expect(res.members.find((m) => m.userId === FIXTURE_USER_A.id)?.role).toBe(
      ChatMemberRole.ADMIN,
    );
  });

  // Bonus Test 5: Duplicate member IDs rejected
  it('5. should reject duplicate member IDs during group creation', async () => {
    await expect(
      chatService.createGroupChat(FIXTURE_USER_A.id, 'Dup Group', [
        FIXTURE_USER_B.id,
        FIXTURE_USER_B.id,
      ]),
    ).rejects.toThrow(BadRequestError);
    expect(mockUserService.validateUsersListExist).not.toHaveBeenCalled();
    expect(mockChatRepo.createGroupChatWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Test 6: Duplicate group creation creates separate groups
  it('6. should allow creating separate groups with identical name and members', async () => {
    mockUserService.validateUsersListExist.mockResolvedValue([]);
    const members1 = [
      makeMember('group-1', FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember('group-1', FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    const members2 = [
      makeMember('group-2', FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember('group-2', FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.createGroupChatWithTransaction
      .mockResolvedValueOnce(makeGroupChat('group-1', 'Same Name', FIXTURE_USER_A.id, members1))
      .mockResolvedValueOnce(makeGroupChat('group-2', 'Same Name', FIXTURE_USER_A.id, members2));

    const first = await chatService.createGroupChat(FIXTURE_USER_A.id, 'Same Name', [
      FIXTURE_USER_B.id,
    ]);
    const second = await chatService.createGroupChat(FIXTURE_USER_A.id, 'Same Name', [
      FIXTURE_USER_B.id,
    ]);

    expect(first.id).toBe('group-1');
    expect(second.id).toBe('group-2');
    expect(first.id).not.toBe(second.id);
  });

  it('should reject empty or whitespace-only group names', async () => {
    await expect(
      chatService.createGroupChat(FIXTURE_USER_A.id, '   ', [FIXTURE_USER_B.id]),
    ).rejects.toThrow(BadRequestError);
  });

  // Bonus Test 7: Add group members successfully
  it('7. should allow group admin to add new members', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    const updatedMembers = [
      ...currentMembers,
      makeMember(groupId, FIXTURE_USER_C.id, ChatMemberRole.MEMBER),
    ];

    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );
    mockUserService.validateUsersListExist.mockResolvedValue([FIXTURE_USER_C as User]);
    mockChatRepo.addGroupMembersWithTransaction.mockResolvedValue(updatedMembers);

    const res = await chatService.addGroupMembers(groupId, FIXTURE_USER_A.id, [FIXTURE_USER_C.id]);

    expect(res.chatId).toBe(groupId);
    expect(res.members).toHaveLength(3);
    expect(res.members.find((m) => m.userId === FIXTURE_USER_C.id)?.role).toBe(
      ChatMemberRole.MEMBER,
    );
  });

  // Bonus Test 8: Non-admin attempts to add members
  it('8. should forbid non-admin member from adding members', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );

    await expect(
      chatService.addGroupMembers(groupId, FIXTURE_USER_B.id, [FIXTURE_USER_C.id]),
    ).rejects.toThrow(ForbiddenError);
    expect(mockChatRepo.addGroupMembersWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Test 9: Add already existing member
  it('9. should reject adding a user who is already a group member with ConflictError', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );

    await expect(
      chatService.addGroupMembers(groupId, FIXTURE_USER_A.id, [FIXTURE_USER_B.id]),
    ).rejects.toThrow(ConflictError);
    expect(mockChatRepo.addGroupMembersWithTransaction).not.toHaveBeenCalled();
  });

  it('should reject adding members to a DIRECT chat', async () => {
    const directChat = new Chat();
    directChat.id = 'direct-1';
    directChat.type = ChatType.DIRECT;
    mockChatRepo.findById.mockResolvedValue(directChat);

    await expect(
      chatService.addGroupMembers('direct-1', FIXTURE_USER_A.id, [FIXTURE_USER_C.id]),
    ).rejects.toThrow(BadRequestError);
  });

  // Bonus Test 10: Remove group member
  it('10. should allow admin to remove another group member', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );
    mockChatRepo.removeGroupMemberWithTransaction.mockResolvedValue([currentMembers[0]]);

    const res = await chatService.removeGroupMember(groupId, FIXTURE_USER_A.id, FIXTURE_USER_B.id);

    expect(res.removedUserId).toBe(FIXTURE_USER_B.id);
    expect(res.members).toHaveLength(1);
    expect(res.members[0].userId).toBe(FIXTURE_USER_A.id);
  });

  // Bonus Test 11: Non-admin attempts to remove member
  it('11. should forbid non-admin member from removing another member', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
      makeMember(groupId, FIXTURE_USER_C.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );

    await expect(
      chatService.removeGroupMember(groupId, FIXTURE_USER_B.id, FIXTURE_USER_C.id),
    ).rejects.toThrow(ForbiddenError);
    expect(mockChatRepo.removeGroupMemberWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Test 12: Member voluntarily leaves
  it('12. should allow a non-admin member to voluntarily leave the group', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );
    mockChatRepo.removeGroupMemberWithTransaction.mockResolvedValue([currentMembers[0]]);

    const res = await chatService.removeGroupMember(groupId, FIXTURE_USER_B.id, FIXTURE_USER_B.id);

    expect(res.removedUserId).toBe(FIXTURE_USER_B.id);
    expect(res.members).toHaveLength(1);
  });

  // Bonus Test 13: Last admin protection
  it('13. should prevent removing or leaving as the last group administrator', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );

    await expect(
      chatService.removeGroupMember(groupId, FIXTURE_USER_A.id, FIXTURE_USER_A.id),
    ).rejects.toThrow(BadRequestError);
    expect(mockChatRepo.removeGroupMemberWithTransaction).not.toHaveBeenCalled();
  });

  it('should allow removing/leaving an admin if another administrator remains', async () => {
    const currentMembers = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_C.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, currentMembers),
    );
    mockChatRepo.removeGroupMemberWithTransaction.mockResolvedValue([
      currentMembers[1],
      currentMembers[2],
    ]);

    const res = await chatService.removeGroupMember(groupId, FIXTURE_USER_A.id, FIXTURE_USER_A.id);
    expect(res.members).toHaveLength(2);
  });

  // Bonus Test 14: Update group name
  it('14. should allow admin to update group name', async () => {
    const members = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Old Name', FIXTURE_USER_A.id, members),
    );
    mockChatRepo.updateGroupWithTransaction.mockResolvedValue(
      makeGroupChat(groupId, 'Updated Development Team', FIXTURE_USER_A.id, members),
    );

    const res = await chatService.updateGroup(
      groupId,
      FIXTURE_USER_A.id,
      '  Updated Development Team  ',
    );
    expect(res.name).toBe('Updated Development Team');
    expect(mockChatRepo.updateGroupWithTransaction).toHaveBeenCalledWith(
      groupId,
      FIXTURE_USER_A.id,
      'Updated Development Team',
    );
  });

  // Bonus Test 15: Non-admin attempts to update group name
  it('15. should forbid non-admin from updating group name', async () => {
    const members = [
      makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
      makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
    ];
    mockChatRepo.findById.mockResolvedValue(
      makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, members),
    );

    await expect(
      chatService.updateGroup(groupId, FIXTURE_USER_B.id, 'Hacked Name'),
    ).rejects.toThrow(ForbiddenError);
    expect(mockChatRepo.updateGroupWithTransaction).not.toHaveBeenCalled();
  });

  // Bonus Tests 16 & 17: Removed member loses access to sending and reading group messages
  describe('Group Chat Messaging Authorization (Tests 16 - 17)', () => {
    let messageService: MessageService;
    let mockMessageRepo: jest.Mocked<MessageRepository>;
    let realBackedChatService: ChatService;

    beforeEach(() => {
      mockMessageRepo = {
        createMessage: jest.fn(),
        findMessageById: jest.fn(),
        getMessages: jest.fn(),
        editMessage: jest.fn(),
        softDeleteMessage: jest.fn(),
      } as unknown as jest.Mocked<MessageRepository>;

      realBackedChatService = new ChatService(mockChatRepo, mockUserService);
      messageService = new MessageService(mockMessageRepo, realBackedChatService);
    });

    it('16. should block a removed group member from sending messages with ForbiddenError', async () => {
      const membersWithoutD = [
        makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
        makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
      ];
      mockChatRepo.findById.mockResolvedValue(
        makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, membersWithoutD),
      );
      mockChatRepo.isUserMember.mockResolvedValue(false);

      await expect(
        messageService.sendMessage(groupId, FIXTURE_USER_D.id, 'Can I still talk?'),
      ).rejects.toThrow(ForbiddenError);
      expect(mockMessageRepo.createMessage).not.toHaveBeenCalled();
    });

    it('17. should block a removed group member from retrieving group messages with ForbiddenError', async () => {
      const membersWithoutD = [
        makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN),
        makeMember(groupId, FIXTURE_USER_B.id, ChatMemberRole.MEMBER),
      ];
      mockChatRepo.findById.mockResolvedValue(
        makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, membersWithoutD),
      );
      mockChatRepo.isUserMember.mockResolvedValue(false);

      await expect(
        messageService.getMessages(groupId, 50, undefined, FIXTURE_USER_D.id),
      ).rejects.toThrow(ForbiddenError);
      expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
    });

    it('should require user identification when reading GROUP chat messages', async () => {
      const members = [makeMember(groupId, FIXTURE_USER_A.id, ChatMemberRole.ADMIN)];
      mockChatRepo.findById.mockResolvedValue(
        makeGroupChat(groupId, 'Team', FIXTURE_USER_A.id, members),
      );

      await expect(messageService.getMessages(groupId, 50)).rejects.toThrow(UnauthorizedError);
      expect(mockMessageRepo.getMessages).not.toHaveBeenCalled();
    });
  });
});
