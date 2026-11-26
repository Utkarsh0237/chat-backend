import Joi from 'joi';
import { GROUP_CONSTANTS } from '../../common/constants';

export const createChatSchema = Joi.object({
  userAId: Joi.string().uuid().required().messages({
    'string.guid': 'userAId must be a valid UUID',
    'any.required': 'userAId is required',
  }),
  userBId: Joi.string().uuid().invalid(Joi.ref('userAId')).required().messages({
    'string.guid': 'userBId must be a valid UUID',
    'any.invalid': 'userAId and userBId cannot be identical',
    'any.required': 'userBId is required',
  }),
});

export const chatIdParamSchema = Joi.object({
  chatId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid chat ID format (UUID required)',
    'any.required': 'Chat ID is required',
  }),
});

export const createGroupChatSchema = Joi.object({
  creatorId: Joi.string().uuid().required().messages({
    'string.guid': 'creatorId must be a valid UUID',
    'any.required': 'creatorId is required',
  }),
  name: Joi.string()
    .trim()
    .min(GROUP_CONSTANTS.NAME_MIN_LENGTH)
    .max(GROUP_CONSTANTS.NAME_MAX_LENGTH)
    .required()
    .messages({
      'string.base': 'Group name must be a string',
      'string.empty': 'Group name cannot be empty or whitespace only',
      'string.min': `Group name must be at least ${GROUP_CONSTANTS.NAME_MIN_LENGTH} character`,
      'string.max': `Group name cannot exceed ${GROUP_CONSTANTS.NAME_MAX_LENGTH} characters`,
      'any.required': 'Group name is required',
    }),
  memberIds: Joi.array()
    .items(
      Joi.string().uuid().messages({
        'string.guid': 'Each memberId must be a valid UUID',
      }),
    )
    .min(GROUP_CONSTANTS.MIN_MEMBERS)
    .max(GROUP_CONSTANTS.MAX_MEMBERS)
    .unique()
    .required()
    .messages({
      'array.base': 'memberIds must be an array of UUIDs',
      'array.min': `memberIds must contain at least ${GROUP_CONSTANTS.MIN_MEMBERS} member`,
      'array.max': `memberIds cannot exceed ${GROUP_CONSTANTS.MAX_MEMBERS} members`,
      'array.unique': 'Duplicate member IDs are not allowed',
      'any.required': 'memberIds is required',
    }),
}).unknown(false);

export const addGroupMembersSchema = Joi.object({
  requesterId: Joi.string().uuid().required().messages({
    'string.guid': 'requesterId must be a valid UUID',
    'any.required': 'requesterId is required',
  }),
  memberIds: Joi.array()
    .items(
      Joi.string().uuid().messages({
        'string.guid': 'Each memberId must be a valid UUID',
      }),
    )
    .min(GROUP_CONSTANTS.MIN_MEMBERS)
    .max(GROUP_CONSTANTS.MAX_MEMBERS)
    .unique()
    .required()
    .messages({
      'array.base': 'memberIds must be an array of UUIDs',
      'array.min': `memberIds must contain at least ${GROUP_CONSTANTS.MIN_MEMBERS} member`,
      'array.max': `memberIds cannot exceed ${GROUP_CONSTANTS.MAX_MEMBERS} members`,
      'array.unique': 'Duplicate member IDs are not allowed',
      'any.required': 'memberIds is required',
    }),
}).unknown(false);

export const removeMemberParamSchema = Joi.object({
  chatId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid chat ID format (UUID required)',
    'any.required': 'Chat ID is required',
  }),
  memberId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid member ID format (UUID required)',
    'any.required': 'Member ID is required',
  }),
});

export const removeGroupMemberSchema = Joi.object({
  requesterId: Joi.string().uuid().required().messages({
    'string.guid': 'requesterId must be a valid UUID',
    'any.required': 'requesterId is required',
  }),
}).unknown(false);

export const updateGroupSchema = Joi.object({
  requesterId: Joi.string().uuid().required().messages({
    'string.guid': 'requesterId must be a valid UUID',
    'any.required': 'requesterId is required',
  }),
  name: Joi.string()
    .trim()
    .min(GROUP_CONSTANTS.NAME_MIN_LENGTH)
    .max(GROUP_CONSTANTS.NAME_MAX_LENGTH)
    .required()
    .messages({
      'string.base': 'Group name must be a string',
      'string.empty': 'Group name cannot be empty or whitespace only',
      'string.min': `Group name must be at least ${GROUP_CONSTANTS.NAME_MIN_LENGTH} character`,
      'string.max': `Group name cannot exceed ${GROUP_CONSTANTS.NAME_MAX_LENGTH} characters`,
      'any.required': 'Group name is required',
    }),
}).unknown(false);
