import { Router } from 'express';
import { ReadReceiptController } from './read-receipt.controller';
import { validateBody, validateParams } from '../../middleware/validation.middleware';
import { markReadSchema, markReadParamSchema } from './read-receipt.validation';

const router = Router({ mergeParams: true });
const readReceiptController = new ReadReceiptController();

router.post(
  '/:messageId/read',
  validateParams(markReadParamSchema),
  validateBody(markReadSchema),
  readReceiptController.markRead,
);

export default router;
