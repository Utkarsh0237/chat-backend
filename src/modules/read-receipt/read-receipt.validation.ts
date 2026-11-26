import Joi from 'joi';

export const markReadSchema = Joi.object({
  userId: Joi.string().uuid().required().messages({
    'string.guid': 'userId must be a valid UUID',
    'any.required': 'userId is required',
  }),
});

export const updateLastSeenSchema = Joi.object({
  userId: Joi.string().uuid().required().messages({
    'string.guid': 'userId must be a valid UUID',
    'any.required': 'userId is required',
  }),
  messageId: Joi.string().trim().required().messages({
    'string.empty': 'messageId cannot be empty',
    'any.required': 'messageId is required',
  }),
});

export const markReadParamSchema = Joi.object({
  chatId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid chat ID format (UUID required)',
    'any.required': 'Chat ID is required',
  }),
  messageId: Joi.string().trim().required().messages({
    'string.empty': 'messageId cannot be empty',
    'any.required': 'messageId is required',
  }),
});
