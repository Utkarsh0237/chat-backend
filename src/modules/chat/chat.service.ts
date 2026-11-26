import { ChatRepository } from './chat.repository';
import { UserService } from '../user/user.service';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '../../common/errors';
import { getCanonicalDirectParticipantKey } from '../../common/utils';
import { Chat } from '../../entities/Chat.entity';
import { ChatMember } from '../../entities/ChatMember.entity';
import { ChatMemberRole, ChatType, GROUP_CONSTANTS } from '../../common/constants';
import { GroupChatResponse, GroupMemberInfo, UserChatResponse } from '../../common/types';

export class ChatService {
  constructor(
    private chatRepo = new ChatRepository(),
    private userService = new UserService(),
  ) {}

  private mapGroupMember(member: ChatMember): GroupMemberInfo {
    return {
      userId: member.userId,
      role: (member.role as ChatMemberRole) || ChatMemberRole.MEMBER,
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : new Date().toISOString(),
    };
  }

  private mapGroupChatResponse(chat: Chat): GroupChatResponse {
    return {
      id: chat.id,
      type: ChatType.GROUP,
      name: chat.name ?? null,
      createdBy: chat.createdBy ?? null,
      members: chat.members ? chat.members.map((m) => this.mapGroupMember(m)) : [],
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      lastActivityAt: chat.lastActivityAt.toISOString(),
    };
  }

  private validateGroupName(rawName: string): string {
    const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
    if (!trimmed || trimmed.length < GROUP_CONSTANTS.NAME_MIN_LENGTH) {
      throw new BadRequestError('Group name cannot be empty or whitespace only');
    }
    if (trimmed.length > GROUP_CONSTANTS.NAME_MAX_LENGTH) {
      throw new BadRequestError(
        `Group name exceeds maximum allowed length of ${GROUP_CONSTANTS.NAME_MAX_LENGTH} characters`,
      );
    }
    return trimmed;
  }

  private assertUniqueMemberIds(memberIds: string[]): void {
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new BadRequestError('At least one member ID must be provided');
    }
    if (new Set(memberIds).size !== memberIds.length) {
      throw new BadRequestError('Duplicate member IDs are not allowed');
    }
  }

  /**
   * API 1: Create or Get Direct Chat
   */
  async createOrGetDirectChat(
    userAId: string,
    userBId: string,
  ): Promise<{ chatId: string; isNew: boolean }> {
    if (userAId === userBId) {
      throw new BadRequestError('Cannot create a direct chat with oneself (identical user IDs)');
    }

    // Verify both users exist in PostgreSQL
    await this.userService.validateUsersExist(userAId, userBId);

    const canonicalKey = getCanonicalDirectParticipantKey(userAId, userBId);
    const result = await this.chatRepo.createDirectChatWithTransaction(
      canonicalKey,
      userAId,
      userBId,
    );

    return {
      chatId: result.chat.id,
      isNew: result.isNew,
    };
  }

  /**
   * Bonus Feature 1.1: Create Group Chat
   * Always creates a distinct GROUP chat with the creator as ADMIN.
   */
  async createGroupChat(
    creatorId: string,
    rawName: string,
    memberIds: string[],
  ): Promise<GroupChatResponse> {
    const name = this.validateGroupName(rawName);
    this.assertUniqueMemberIds(memberIds);

    // Ensure creator appears once (as ADMIN) even if omitted from memberIds
    const otherMemberIds = memberIds.filter((id) => id !== creatorId);

    // Validate creator and all members exist in PostgreSQL
    await this.userService.validateUsersListExist([creatorId, ...otherMemberIds]);

    const savedChat = await this.chatRepo.createGroupChatWithTransaction(
      creatorId,
      name,
      otherMemberIds,
    );

    return this.mapGroupChatResponse(savedChat);
  }

  /**
   * Bonus Feature 1.2: Add Group Members (Admin only)
   */
  async addGroupMembers(
    chatId: string,
    requesterId: string,
    memberIds: string[],
  ): Promise<{ chatId: string; members: GroupMemberInfo[] }> {
    this.assertUniqueMemberIds(memberIds);

    const chat = await this.getChatById(chatId);
    if (chat.type !== ChatType.GROUP) {
      throw new BadRequestError('Members can only be added to group chats');
    }

    const currentMembers = chat.members ?? [];
    const requester = currentMembers.find((m) => m.userId === requesterId);
    if (!requester) {
      throw new ForbiddenError('You are not an authorized member of this chat');
    }
    if (requester.role !== ChatMemberRole.ADMIN) {
      throw new ForbiddenError('Only group admins can add members');
    }

    const existingSet = new Set(currentMembers.map((m) => m.userId));
    for (const candidateId of memberIds) {
      if (existingSet.has(candidateId)) {
        throw new ConflictError(`User with id "${candidateId}" is already a member of this group`);
      }
    }

    // Validate all new member users exist before executing DB transaction
    await this.userService.validateUsersListExist(memberIds);

    const updatedMembers = await this.chatRepo.addGroupMembersWithTransaction(
      chatId,
      requesterId,
      memberIds,
    );

    return {
      chatId,
      members: updatedMembers.map((m) => this.mapGroupMember(m)),
    };
  }

  /**
   * Bonus Feature 1.3: Remove Group Member or Leave Group
   * Admin can remove others; any member can leave voluntarily; last admin is protected.
   */
  async removeGroupMember(
    chatId: string,
    requesterId: string,
    memberId: string,
  ): Promise<{ chatId: string; removedUserId: string; members: GroupMemberInfo[] }> {
    const chat = await this.getChatById(chatId);
    if (chat.type !== ChatType.GROUP) {
      throw new BadRequestError('Members can only be removed from group chats');
    }

    const currentMembers = chat.members ?? [];
    const requester = currentMembers.find((m) => m.userId === requesterId);
    if (!requester) {
      throw new ForbiddenError('You are not an authorized member of this chat');
    }

    const target = currentMembers.find((m) => m.userId === memberId);
    if (!target) {
      throw new NotFoundError(`User with id "${memberId}" is not a member of this group`);
    }

    const isSelfLeave = requesterId === memberId;
    if (!isSelfLeave && requester.role !== ChatMemberRole.ADMIN) {
      throw new ForbiddenError('Only group admins can remove other members');
    }

    if (target.role === ChatMemberRole.ADMIN) {
      const adminCount = currentMembers.filter((m) => m.role === ChatMemberRole.ADMIN).length;
      if (adminCount <= 1) {
        throw new BadRequestError('Cannot remove the last administrator from the group');
      }
    }

    const remainingMembers = await this.chatRepo.removeGroupMemberWithTransaction(
      chatId,
      requesterId,
      memberId,
    );

    return {
      chatId,
      removedUserId: memberId,
      members: remainingMembers.map((m) => this.mapGroupMember(m)),
    };
  }

  /**
   * Bonus Feature 1.4: Update Group Information (Admin only)
   */
  async updateGroup(
    chatId: string,
    requesterId: string,
    rawName: string,
  ): Promise<GroupChatResponse> {
    const name = this.validateGroupName(rawName);

    const chat = await this.getChatById(chatId);
    if (chat.type !== ChatType.GROUP) {
      throw new BadRequestError('Group details can only be updated for group chats');
    }

    const currentMembers = chat.members ?? [];
    const requester = currentMembers.find((m) => m.userId === requesterId);
    if (!requester) {
      throw new ForbiddenError('You are not an authorized member of this chat');
    }
    if (requester.role !== ChatMemberRole.ADMIN) {
      throw new ForbiddenError('Only group admins can update group details');
    }

    const updatedChat = await this.chatRepo.updateGroupWithTransaction(chatId, requesterId, name);
    return this.mapGroupChatResponse(updatedChat);
  }

  /**
   * Fetches chat by ID.
   */
  async getChatById(chatId: string): Promise<Chat> {
    const chat = await this.chatRepo.findById(chatId);
    if (!chat) {
      throw new NotFoundError(`Chat with id "${chatId}" not found`);
    }
    return chat;
  }

  /**
   * Verifies that chat exists and user is an authorized member.
   */
  async verifyMembership(chatId: string, userId: string): Promise<void> {
    const chat = await this.chatRepo.findById(chatId);
    if (!chat) {
      throw new NotFoundError(`Chat with id "${chatId}" not found`);
    }

    const isMember = await this.chatRepo.isUserMember(chatId, userId);
    if (!isMember) {
      throw new ForbiddenError('You are not an authorized member of this chat');
    }
  }

  /**
   * API 6: List User Chats
   */
  async listUserChats(userId: string): Promise<UserChatResponse[]> {
    // Validate that the user actually exists
    await this.userService.getUserById(userId);

    const chats = await this.chatRepo.findUserChats(userId);

    return chats.map((chat) => {
      const memberIds = chat.members ? chat.members.map((m) => m.userId) : [];
      return {
        id: chat.id,
        type: chat.type,
        name: chat.name ?? null,
        memberIds,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
        lastActivityAt: chat.lastActivityAt.toISOString(),
      };
    });
  }

  /**
   * Updates chat activity timestamp in PostgreSQL when a message is sent.
   */
  async recordActivity(chatId: string, timestamp?: Date): Promise<void> {
    try {
      await this.chatRepo.updateLastActivity(chatId, timestamp);
    } catch {
      // Non-blocking fallback: logging failure without breaking message send
    }
  }
}
