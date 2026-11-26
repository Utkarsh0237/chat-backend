import { Router, Request, Response, NextFunction } from 'express';
import { ChatController } from './chat.controller';
import { MessageController } from '../message/message.controller';
import { ReadReceiptController } from '../read-receipt/read-receipt.controller';
import { config } from '../../config/env';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validation.middleware';
import {
  createChatSchema,
  chatIdParamSchema,
  createGroupChatSchema,
  addGroupMembersSchema,
  removeMemberParamSchema,
  removeGroupMemberSchema,
  updateGroupSchema,
} from './chat.validation';
import {
  sendMessageSchema,
  getMessagesQuerySchema,
  messageIdParamSchema,
  editMessageSchema,
  deleteMessageSchema,
} from '../message/message.validation';
import {
  markReadSchema,
  updateLastSeenSchema,
  markReadParamSchema,
} from '../read-receipt/read-receipt.validation';

const router = Router();
const chatController = new ChatController();
const messageController = new MessageController();
const readReceiptController = new ReadReceiptController();

/**
 * Hydrates missing actor ID field in req.body from req.user.id when strict JWT auth is enabled
 * (or on DELETE endpoints when X-User-Id / Bearer header is provided without a JSON body field).
 * Never overwrites an explicitly supplied body field so mismatched body IDs are caught and rejected (403).
 */
function hydrateBodyUserField(
  fieldName: 'requesterId' | 'senderId' | 'creatorId' | 'userId',
  onlyInAuthRequired = false,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (onlyInAuthRequired && !config.auth.authRequired) {
      next();
      return;
    }
    if (req.user?.id && (!req.body || req.body[fieldName] === undefined)) {
      req.body = { ...(req.body ?? {}), [fieldName]: req.user.id };
    }
    next();
  };
}

// API 1: POST /chat/create
router.post('/create', validateBody(createChatSchema), chatController.createOrGetChat);

// Bonus 1.1: POST /chat/group/create
router.post(
  '/group/create',
  hydrateBodyUserField('creatorId', true),
  validateBody(createGroupChatSchema),
  chatController.createGroupChat,
);

// Bonus 1.2: POST /chat/:chatId/members
router.post(
  '/:chatId/members',
  validateParams(chatIdParamSchema),
  hydrateBodyUserField('requesterId', true),
  validateBody(addGroupMembersSchema),
  chatController.addGroupMembers,
);

// Bonus 1.3: DELETE /chat/:chatId/members/:memberId
router.delete(
  '/:chatId/members/:memberId',
  validateParams(removeMemberParamSchema),
  hydrateBodyUserField('requesterId'),
  validateBody(removeGroupMemberSchema),
  chatController.removeGroupMember,
);

// Bonus 1.4: PATCH /chat/:chatId/group
router.patch(
  '/:chatId/group',
  validateParams(chatIdParamSchema),
  hydrateBodyUserField('requesterId', true),
  validateBody(updateGroupSchema),
  chatController.updateGroup,
);

// API 2: POST /chat/:chatId/message/send
router.post(
  '/:chatId/message/send',
  validateParams(chatIdParamSchema),
  hydrateBodyUserField('senderId', true),
  validateBody(sendMessageSchema),
  messageController.sendMessage,
);

// API 3: GET /chat/:chatId/messages?limit=50
router.get(
  '/:chatId/messages',
  validateParams(chatIdParamSchema),
  validateQuery(getMessagesQuerySchema),
  messageController.getMessages,
);

// Bonus 2.1: PATCH /chat/:chatId/message/:messageId
router.patch(
  '/:chatId/message/:messageId',
  validateParams(messageIdParamSchema),
  hydrateBodyUserField('senderId', true),
  validateBody(editMessageSchema),
  messageController.editMessage,
);

// Bonus 2.2: DELETE /chat/:chatId/message/:messageId
router.delete(
  '/:chatId/message/:messageId',
  validateParams(messageIdParamSchema),
  hydrateBodyUserField('senderId'),
  validateBody(deleteMessageSchema),
  messageController.deleteMessage,
);

// API 4: POST /chat/:chatId/message/:messageId/read
router.post(
  '/:chatId/message/:messageId/read',
  validateParams(markReadParamSchema),
  hydrateBodyUserField('userId', true),
  validateBody(markReadSchema),
  readReceiptController.markRead,
);

// API 5: POST /chat/:chatId/lastseen
router.post(
  '/:chatId/lastseen',
  validateParams(chatIdParamSchema),
  hydrateBodyUserField('userId', true),
  validateBody(updateLastSeenSchema),
  readReceiptController.updateLastSeen,
);

export default router;
