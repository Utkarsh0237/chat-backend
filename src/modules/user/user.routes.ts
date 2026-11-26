import { Router } from 'express';
import { UserController } from './user.controller';
import { validateBody, validateParams } from '../../middleware/validation.middleware';
import { restrictUserCreationToDev } from '../../middleware/auth.middleware';
import { createUserSchema, userIdParamSchema } from './user.validation';
import { ChatController } from '../chat/chat.controller';

const router = Router();
const userController = new UserController();
const chatController = new ChatController();

router.post('/', restrictUserCreationToDev, validateBody(createUserSchema), userController.create);
router.get('/:userId', validateParams(userIdParamSchema), userController.getById);

// API 6: GET /user/:userId/chats
router.get('/:userId/chats', validateParams(userIdParamSchema), chatController.listUserChats);

export default router;
