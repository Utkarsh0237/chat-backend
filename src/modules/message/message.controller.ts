import { Request, Response, NextFunction } from 'express';
import { MessageService } from './message.service';
import { enforceAuthenticatedActor } from '../../middleware/auth.middleware';
import { config } from '../../config/env';

export class MessageController {
  constructor(private messageService = new MessageService()) {}

  /**
   * API 2: Send Message
   * POST /chat/:chatId/message/send
   */
  sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId } = req.params;
      const { senderId, text } = req.body;
      enforceAuthenticatedActor(req, senderId);

      const message = await this.messageService.sendMessage(chatId, senderId, text);

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: message,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 3: Get Messages
   * GET /chat/:chatId/messages?limit=50&cursor=...
   */
  getMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId } = req.params;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const cursor = req.query.cursor as string | undefined;
      const queryUserId = req.query.userId as string | undefined;

      // In AUTH_REQUIRED=true mode, reject mismatched query userId and rely strictly on verified JWT
      if (config.auth.authRequired && req.user) {
        if (queryUserId) {
          enforceAuthenticatedActor(req, queryUserId);
        }
      }

      const requesterId =
        req.user?.id || (req.headers['x-user-id'] as string | undefined) || queryUserId;

      const paginatedResult = await this.messageService.getMessages(
        chatId,
        limit,
        cursor,
        requesterId,
      );

      res.status(200).json({
        success: true,
        data: paginatedResult,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 2.1: Edit Message
   * PATCH /chat/:chatId/message/:messageId
   */
  editMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId, messageId } = req.params;
      const { senderId, text } = req.body;
      enforceAuthenticatedActor(req, senderId);

      const updatedMessage = await this.messageService.editMessage(
        chatId,
        messageId,
        senderId,
        text,
      );

      res.status(200).json({
        success: true,
        message: 'Message updated successfully',
        data: updatedMessage,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 2.2: Soft-Delete Message
   * DELETE /chat/:chatId/message/:messageId
   */
  deleteMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId, messageId } = req.params;
      const { senderId } = req.body;
      enforceAuthenticatedActor(req, senderId);

      const deletedMessage = await this.messageService.deleteMessage(chatId, messageId, senderId);

      res.status(200).json({
        success: true,
        message: 'Message deleted successfully',
        data: deletedMessage,
      });
    } catch (err) {
      next(err);
    }
  };
}
