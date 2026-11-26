import { Request, Response, NextFunction } from 'express';
import { ChatService } from './chat.service';
import { enforceAuthenticatedActor } from '../../middleware/auth.middleware';
import { config } from '../../config/env';
import { ForbiddenError } from '../../common/errors';

export class ChatController {
  constructor(private chatService = new ChatService()) {}

  /**
   * API 1: Create or Get Chat
   * POST /chat/create
   */
  createOrGetChat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userAId, userBId } = req.body;
      if (
        config.auth.authRequired &&
        req.user &&
        req.user.id !== userAId &&
        req.user.id !== userBId
      ) {
        throw new ForbiddenError('Authenticated identity must participate in direct chat');
      }
      const result = await this.chatService.createOrGetDirectChat(userAId, userBId);

      res.status(result.isNew ? 201 : 200).json({
        success: true,
        data: {
          chatId: result.chatId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 1.1: Create Group Chat
   * POST /chat/group/create
   */
  createGroupChat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { creatorId, name, memberIds } = req.body;
      enforceAuthenticatedActor(req, creatorId);
      const group = await this.chatService.createGroupChat(creatorId, name, memberIds);

      res.status(201).json({
        success: true,
        message: 'Group chat created successfully',
        data: group,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 1.2: Add Group Members
   * POST /chat/:chatId/members
   */
  addGroupMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId } = req.params;
      const { requesterId, memberIds } = req.body;
      enforceAuthenticatedActor(req, requesterId);
      const result = await this.chatService.addGroupMembers(chatId, requesterId, memberIds);

      res.status(200).json({
        success: true,
        message: 'Group members added successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 1.3: Remove Group Member / Leave Group
   * DELETE /chat/:chatId/members/:memberId
   */
  removeGroupMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId, memberId } = req.params;
      const { requesterId } = req.body;
      enforceAuthenticatedActor(req, requesterId);
      const result = await this.chatService.removeGroupMember(chatId, requesterId, memberId);

      res.status(200).json({
        success: true,
        message:
          requesterId === memberId ? 'Left group successfully' : 'Member removed successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Bonus Feature 1.4: Update Group Information
   * PATCH /chat/:chatId/group
   */
  updateGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { chatId } = req.params;
      const { requesterId, name } = req.body;
      enforceAuthenticatedActor(req, requesterId);
      const updated = await this.chatService.updateGroup(chatId, requesterId, name);

      res.status(200).json({
        success: true,
        message: 'Group information updated successfully',
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 6: List User Chats
   * GET /user/:userId/chats
   */
  listUserChats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      enforceAuthenticatedActor(req, userId);
      const chats = await this.chatService.listUserChats(userId);

      res.status(200).json({
        success: true,
        data: chats,
      });
    } catch (err) {
      next(err);
    }
  };
}
