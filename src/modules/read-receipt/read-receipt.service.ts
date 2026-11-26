import { ReadReceiptRepository } from './read-receipt.repository';
import { ChatService } from '../chat/chat.service';
import { MessageService } from '../message/message.service';
import { NotFoundError, BadRequestError } from '../../common/errors';

export class ReadReceiptService {
  constructor(
    private readReceiptRepo = new ReadReceiptRepository(),
    private chatService = new ChatService(),
    private messageService = new MessageService(),
  ) {}

  /**
   * API 4: Mark Message Read
   */
  async markMessageRead(
    chatId: string,
    messageId: string,
    userId: string,
  ): Promise<{ messageId: string; userId: string; readAt: string }> {
    // 1. Verify chat membership
    await this.chatService.verifyMembership(chatId, userId);

    // 2. Verify message exists in the requested chat
    const message = await this.messageService.getMessageById(chatId, messageId);
    if (!message) {
      throw new NotFoundError(`Message with id "${messageId}" does not exist in chat "${chatId}"`);
    }

    // 3. Prevent users from marking their own messages as read
    if (message.senderId === userId) {
      throw new BadRequestError('Users cannot mark their own messages as read');
    }

    // 4. Save read receipt in Firestore (idempotent)
    const receipt = await this.readReceiptRepo.saveReadReceipt(chatId, messageId, userId);

    return {
      messageId,
      userId: receipt.userId,
      readAt: receipt.readAt,
    };
  }

  /**
   * API 5: Update Last Seen Message
   */
  async updateLastSeen(
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<{ chatId: string; userId: string; lastSeenMessageId: string; lastSeenAt: string }> {
    // 1. Verify chat membership
    await this.chatService.verifyMembership(chatId, userId);

    // 2. Verify message exists in the requested chat
    const message = await this.messageService.getMessageById(chatId, messageId);
    if (!message) {
      throw new NotFoundError(`Message with id "${messageId}" does not exist in chat "${chatId}"`);
    }

    // 3. Execute atomic, non-regressive last seen update
    const result = await this.readReceiptRepo.updateLastSeenAtomic(chatId, userId, message);

    return {
      chatId,
      userId,
      lastSeenMessageId: result.lastSeenMessageId,
      lastSeenAt: result.lastSeenAt,
    };
  }
}
