import Joi from 'joi';
import { MESSAGE_CONSTANTS, PAGINATION_CONSTANTS } from '../../common/constants';

export const sendMessageSchema = Joi.object({
  senderId: Joi.string().uuid().required().messages({
    'string.guid': 'senderId must be a valid UUID',
    'any.required': 'senderId is required',
  }),
  text: Joi.string()
    .trim()
    .min(MESSAGE_CONSTANTS.MIN_LENGTH)
    .max(MESSAGE_CONSTANTS.MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'Message text cannot be empty or whitespace only',
      'string.min': `Message text must be at least ${MESSAGE_CONSTANTS.MIN_LENGTH} character`,
      'string.max': `Message text cannot exceed ${MESSAGE_CONSTANTS.MAX_LENGTH} characters`,
      'any.required': 'Message text is required',
    }),
});

export const editMessageSchema = Joi.object({
  senderId: Joi.string().uuid().required().messages({
    'string.guid': 'senderId must be a valid UUID',
    'any.required': 'senderId is required',
  }),
  text: Joi.string()
    .trim()
    .min(MESSAGE_CONSTANTS.MIN_LENGTH)
    .max(MESSAGE_CONSTANTS.MAX_LENGTH)
    .required()
    .messages({
      'string.base': 'Message text must be a string',
      'string.empty': 'Message text cannot be empty or whitespace only',
      'string.min': `Message text must be at least ${MESSAGE_CONSTANTS.MIN_LENGTH} character`,
      'string.max': `Message text cannot exceed ${MESSAGE_CONSTANTS.MAX_LENGTH} characters`,
      'any.required': 'Message text is required',
    }),
}).unknown(false);

export const deleteMessageSchema = Joi.object({
  senderId: Joi.string().uuid().required().messages({
    'string.guid': 'senderId must be a valid UUID',
    'any.required': 'senderId is required',
  }),
}).unknown(false);

export const getMessagesQuerySchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(PAGINATION_CONSTANTS.MIN_LIMIT)
    .max(PAGINATION_CONSTANTS.MAX_LIMIT)
    .default(PAGINATION_CONSTANTS.DEFAULT_LIMIT)
    .messages({
      'number.base': 'limit must be a number',
      'number.min': `limit must be at least ${PAGINATION_CONSTANTS.MIN_LIMIT}`,
      'number.max': `limit cannot exceed ${PAGINATION_CONSTANTS.MAX_LIMIT}`,
    }),
  cursor: Joi.string().trim().optional().messages({
    'string.base': 'cursor must be a string',
  }),
  userId: Joi.string().uuid().optional().messages({
    'string.guid': 'userId must be a valid UUID',
  }),
});

export const messageIdParamSchema = Joi.object({
  chatId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid chat ID format (UUID required)',
    'any.required': 'Chat ID is required',
  }),
  messageId: Joi.string().trim().min(1).required().messages({
    'string.empty': 'messageId cannot be empty',
    'any.required': 'messageId is required',
  }),
});
