import { MessageRepository } from './message.repository';
import { ChatService } from '../chat/chat.service';
import { BadRequestError, UnauthorizedError } from '../../common/errors';
import { decodeCursor } from '../../common/utils';
import { MessageResponse, PaginatedMessagesResponse } from '../../common/types';
import { MESSAGE_CONSTANTS } from '../../common/constants';

export class MessageService {
  constructor(
    private messageRepo = new MessageRepository(),
    private chatService = new ChatService(),
  ) {}

  private validateAndTrimText(rawText: string): string {
    const text = typeof rawText === 'string' ? rawText.trim() : '';

    if (!text || text.length === 0) {
      throw new BadRequestError('Message text cannot be empty or whitespace only');
    }

    if (text.length > MESSAGE_CONSTANTS.MAX_LENGTH) {
      throw new BadRequestError(
        `Message text exceeds maximum allowed length of ${MESSAGE_CONSTANTS.MAX_LENGTH} characters`,
      );
    }

    return text;
  }

  /**
   * API 2: Send Message
   */
  async sendMessage(chatId: string, senderId: string, rawText: string): Promise<MessageResponse> {
    const text = this.validateAndTrimText(rawText);

    // Verify chat exists and sender is an authorized member
    await this.chatService.verifyMembership(chatId, senderId);

    // Save message document in Firestore
    const savedMessage = await this.messageRepo.createMessage(chatId, senderId, text);

    // Synchronize PostgreSQL lastActivityAt with Firestore's committed server timestamp
    const parsedActivityAt = new Date(savedMessage.createdAt);
    const activityAt = Number.isNaN(parsedActivityAt.getTime()) ? new Date() : parsedActivityAt;
    await this.chatService.recordActivity(chatId, activityAt);

    return savedMessage;
  }

  /**
   * API 3: Get Messages with Cursor Pagination
   * Strictly enforces identity and chat membership on both DIRECT and GROUP chats.
   */
  async getMessages(
    chatId: string,
    limit: number,
    cursor?: string,
    requesterId?: string,
  ): Promise<PaginatedMessagesResponse> {
    // 1. Verify requester identity was provided
    if (!requesterId || requesterId.trim() === '') {
      throw new UnauthorizedError('User identity is required to read chat messages');
    }

    // 2. Verify chat exists in PostgreSQL and requester is an active member
    await this.chatService.verifyMembership(chatId, requesterId);

    // 3. Decode cursor if provided
    let decodedCursor: { timestamp: number; messageId: string } | undefined;
    if (cursor) {
      decodedCursor = decodeCursor(cursor);
    }

    // 4. Retrieve messages from Firestore
    return this.messageRepo.getMessages(chatId, limit, decodedCursor);
  }

  /**
   * Bonus Feature 2.1: Edit Message
   */
  async editMessage(
    chatId: string,
    messageId: string,
    senderId: string,
    rawText: string,
  ): Promise<MessageResponse> {
    const text = this.validateAndTrimText(rawText);

    // Verify chat exists and user is an active member
    await this.chatService.verifyMembership(chatId, senderId);

    return this.messageRepo.editMessage(chatId, messageId, senderId, text);
  }

  /**
   * Bonus Feature 2.2: Soft-Delete Message
   */
  async deleteMessage(
    chatId: string,
    messageId: string,
    senderId: string,
  ): Promise<MessageResponse> {
    // Verify chat exists and user is an active member
    await this.chatService.verifyMembership(chatId, senderId);

    return this.messageRepo.softDeleteMessage(chatId, messageId, senderId);
  }

  /**
   * Helper to retrieve message and verify it exists
   */
  async getMessageById(chatId: string, messageId: string) {
    return this.messageRepo.findMessageById(chatId, messageId);
  }
}
