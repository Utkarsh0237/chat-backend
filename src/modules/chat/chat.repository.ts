import { Repository, DataSource } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Chat } from '../../entities/Chat.entity';
import { ChatMember } from '../../entities/ChatMember.entity';
import { ChatMemberRole, ChatType } from '../../common/constants';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';

export class ChatRepository {
  private chatRepo: Repository<Chat>;
  private memberRepo: Repository<ChatMember>;
  private dataSource: DataSource;

  constructor(dataSource = AppDataSource) {
    this.dataSource = dataSource;
    this.chatRepo = dataSource.getRepository(Chat);
    this.memberRepo = dataSource.getRepository(ChatMember);
  }

  async findById(id: string): Promise<Chat | null> {
    return this.chatRepo.findOne({
      where: { id },
      relations: ['members'],
    });
  }

  async findByCanonicalParticipants(canonicalKey: string): Promise<Chat | null> {
    return this.chatRepo.findOne({
      where: { canonicalParticipants: canonicalKey },
      relations: ['members'],
    });
  }

  /**
   * Fetches all chats for a given user, eagerly loading all member records.
   * Uses an INNER JOIN for filtering and a LEFT JOIN for member loading in a SINGLE SQL query.
   * Completely eliminates N+1 query overhead.
   */
  async findUserChats(userId: string): Promise<Chat[]> {
    return this.chatRepo
      .createQueryBuilder('chat')
      .innerJoin(
        'chat_members',
        'my_membership',
        'my_membership.chatId = chat.id AND my_membership.userId = :userId',
        { userId },
      )
      .leftJoinAndSelect('chat.members', 'all_members')
      .orderBy('chat.lastActivityAt', 'DESC')
      .getMany();
  }

  /**
   * Verifies if a user is a confirmed member of a chat.
   */
  async isUserMember(chatId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepo.findOne({
      where: { chatId, userId },
      select: ['id'],
    });
    return member !== null;
  }

  /**
   * Monotonically advances lastActivityAt for a chat in PostgreSQL so older out-of-order
   * writes cannot overwrite a newer activity timestamp under concurrent message sends.
   */
  async updateLastActivity(chatId: string, activityDate = new Date()): Promise<void> {
    await this.chatRepo
      .createQueryBuilder()
      .update(Chat)
      .set({ lastActivityAt: activityDate })
      .where('id = :chatId', { chatId })
      .andWhere('("lastActivityAt" IS NULL OR "lastActivityAt" < :activityDate)', {
        activityDate,
      })
      .execute();
  }

  /**
   * Concurrently-safe creation of direct chat with atomic membership assignment.
   * If a concurrent request created the chat first, rolls back and returns the existing chat.
   */
  async createDirectChatWithTransaction(
    canonicalKey: string,
    userAId: string,
    userBId: string,
  ): Promise<{ chat: Chat; isNew: boolean }> {
    // 1. Double-check before starting transaction
    const existing = await this.findByCanonicalParticipants(canonicalKey);
    if (existing) {
      return { chat: existing, isNew: false };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create chat record
      const chat = queryRunner.manager.create(Chat, {
        type: ChatType.DIRECT,
        canonicalParticipants: canonicalKey,
        lastActivityAt: new Date(),
      });
      const savedChat = await queryRunner.manager.save(Chat, chat);

      // Create membership records
      const memberA = queryRunner.manager.create(ChatMember, {
        chatId: savedChat.id,
        userId: userAId,
        role: ChatMemberRole.MEMBER,
      });
      const memberB = queryRunner.manager.create(ChatMember, {
        chatId: savedChat.id,
        userId: userBId,
        role: ChatMemberRole.MEMBER,
      });

      await queryRunner.manager.save(ChatMember, [memberA, memberB]);
      await queryRunner.commitTransaction();

      // Return chat with loaded members
      savedChat.members = [memberA, memberB];
      return { chat: savedChat, isNew: true };
    } catch (err) {
      await queryRunner.rollbackTransaction();

      // PostgreSQL error 23505 = unique_violation
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        const raceWonChat = await this.findByCanonicalParticipants(canonicalKey);
        if (raceWonChat) {
          return { chat: raceWonChat, isNew: false };
        }
      }

      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Creates a GROUP chat atomically with creator as ADMIN and supplied members as MEMBER.
   */
  async createGroupChatWithTransaction(
    creatorId: string,
    name: string,
    otherMemberIds: string[],
  ): Promise<Chat> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const chat = queryRunner.manager.create(Chat, {
        type: ChatType.GROUP,
        name,
        createdBy: creatorId,
        canonicalParticipants: null,
        lastActivityAt: new Date(),
      });
      const savedChat = await queryRunner.manager.save(Chat, chat);

      const membersToCreate: ChatMember[] = [
        queryRunner.manager.create(ChatMember, {
          chatId: savedChat.id,
          userId: creatorId,
          role: ChatMemberRole.ADMIN,
        }),
        ...otherMemberIds.map((memberId) =>
          queryRunner.manager.create(ChatMember, {
            chatId: savedChat.id,
            userId: memberId,
            role: ChatMemberRole.MEMBER,
          }),
        ),
      ];

      const savedMembers = await queryRunner.manager.save(ChatMember, membersToCreate);
      await queryRunner.commitTransaction();

      savedChat.members = savedMembers;
      return savedChat;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Atomically adds new members to an existing group chat under row lock.
   * Enforces GROUP chat type, ADMIN requester authorization, and duplicate prevention.
   */
  async addGroupMembersWithTransaction(
    chatId: string,
    requesterId: string,
    newMemberIds: string[],
  ): Promise<ChatMember[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const chat = await queryRunner.manager.findOne(Chat, {
        where: { id: chatId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!chat) {
        throw new NotFoundError(`Chat with id "${chatId}" not found`);
      }

      if (chat.type !== ChatType.GROUP) {
        throw new BadRequestError('Members can only be added to group chats');
      }

      const currentMembers = await queryRunner.manager.find(ChatMember, {
        where: { chatId },
        order: { joinedAt: 'ASC' },
      });

      const requester = currentMembers.find((m) => m.userId === requesterId);
      if (!requester) {
        throw new ForbiddenError('You are not an authorized member of this chat');
      }
      if (requester.role !== ChatMemberRole.ADMIN) {
        throw new ForbiddenError('Only group admins can add members');
      }

      const existingIds = new Set(currentMembers.map((m) => m.userId));
      for (const candidateId of newMemberIds) {
        if (existingIds.has(candidateId)) {
          throw new ConflictError(
            `User with id "${candidateId}" is already a member of this group`,
          );
        }
      }

      const added = newMemberIds.map((userId) =>
        queryRunner.manager.create(ChatMember, {
          chatId,
          userId,
          role: ChatMemberRole.MEMBER,
        }),
      );

      const savedAdded = await queryRunner.manager.save(ChatMember, added);
      await queryRunner.commitTransaction();

      return [...currentMembers, ...savedAdded];
    } catch (err) {
      await queryRunner.rollbackTransaction();
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw new ConflictError('One or more users are already members of this group');
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Atomically removes a member or handles voluntary leave under row lock.
   * Prevents unauthorized removals and protects against removing the last administrator.
   */
  async removeGroupMemberWithTransaction(
    chatId: string,
    requesterId: string,
    memberId: string,
  ): Promise<ChatMember[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const chat = await queryRunner.manager.findOne(Chat, {
        where: { id: chatId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!chat) {
        throw new NotFoundError(`Chat with id "${chatId}" not found`);
      }

      if (chat.type !== ChatType.GROUP) {
        throw new BadRequestError('Members can only be removed from group chats');
      }

      const currentMembers = await queryRunner.manager.find(ChatMember, {
        where: { chatId },
        order: { joinedAt: 'ASC' },
      });

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

      await queryRunner.manager.delete(ChatMember, { id: target.id });
      await queryRunner.commitTransaction();

      return currentMembers.filter((m) => m.id !== target.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Atomically updates group metadata (name) under row lock.
   * Enforces GROUP chat type and ADMIN role authorization.
   */
  async updateGroupWithTransaction(
    chatId: string,
    requesterId: string,
    name: string,
  ): Promise<Chat> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const chat = await queryRunner.manager.findOne(Chat, {
        where: { id: chatId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!chat) {
        throw new NotFoundError(`Chat with id "${chatId}" not found`);
      }

      if (chat.type !== ChatType.GROUP) {
        throw new BadRequestError('Group details can only be updated for group chats');
      }

      const currentMembers = await queryRunner.manager.find(ChatMember, {
        where: { chatId },
        order: { joinedAt: 'ASC' },
      });

      const requester = currentMembers.find((m) => m.userId === requesterId);
      if (!requester) {
        throw new ForbiddenError('You are not an authorized member of this chat');
      }
      if (requester.role !== ChatMemberRole.ADMIN) {
        throw new ForbiddenError('Only group admins can update group details');
      }

      chat.name = name;
      const updatedChat = await queryRunner.manager.save(Chat, chat);
      await queryRunner.commitTransaction();

      updatedChat.members = currentMembers;
      return updatedChat;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
