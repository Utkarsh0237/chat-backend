import Joi from 'joi';

export const createUserSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required().messages({
    'string.empty': 'User name cannot be empty',
    'any.required': 'User name is required',
  }),
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Valid email is required',
    'any.required': 'User email is required',
  }),
});

export const userIdParamSchema = Joi.object({
  userId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid user ID format (UUID required)',
    'any.required': 'User ID is required',
  }),
});
