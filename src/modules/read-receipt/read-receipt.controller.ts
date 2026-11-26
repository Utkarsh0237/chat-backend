import { Request, Response, NextFunction } from 'express';
import { ReadReceiptService } from './read-receipt.service';
import { enforceAuthenticatedActor } from '../../middleware/auth.middleware';

export class ReadReceiptController {
  constructor(private readReceiptService = new ReadReceiptService()) {}

  /**
   * API 4: Mark Message Read
   * POST /chat/:chatId/message/:messageId/read
   */
  markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId, messageId } = req.params;
      const { userId } = req.body;
      enforceAuthenticatedActor(req, userId);

      const result = await this.readReceiptService.markMessageRead(chatId, messageId, userId);

      res.status(200).json({
        success: true,
        message: 'Message marked as read',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 5: Update Last Seen Message
   * POST /chat/:chatId/lastseen
   */
  updateLastSeen = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId } = req.params;
      const { userId, messageId } = req.body;
      enforceAuthenticatedActor(req, userId);

      const result = await this.readReceiptService.updateLastSeen(chatId, userId, messageId);

      res.status(200).json({
        success: true,
        message: 'Last seen updated successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}
