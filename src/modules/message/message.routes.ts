import { Router } from 'express';
import { MessageController } from './message.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validation.middleware';
import { sendMessageSchema, getMessagesQuerySchema } from './message.validation';
import { chatIdParamSchema } from '../chat/chat.validation';

const router = Router({ mergeParams: true });
const messageController = new MessageController();

router.post(
  '/send',
  validateParams(chatIdParamSchema),
  validateBody(sendMessageSchema),
  messageController.sendMessage,
);

router.get(
  '/',
  validateParams(chatIdParamSchema),
  validateQuery(getMessagesQuerySchema),
  messageController.getMessages,
);

export default router;
