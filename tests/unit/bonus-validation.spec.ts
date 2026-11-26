import { Request, Response, NextFunction } from 'express';
import {
  createGroupChatSchema,
  addGroupMembersSchema,
  removeMemberParamSchema,
  removeGroupMemberSchema,
  updateGroupSchema,
} from '../../src/modules/chat/chat.validation';
import {
  editMessageSchema,
  deleteMessageSchema,
  messageIdParamSchema,
} from '../../src/modules/message/message.validation';
import { validateBody } from '../../src/middleware/validation.middleware';
import { BadRequestError } from '../../src/common/errors';
import { MESSAGE_CONSTANTS, GROUP_CONSTANTS } from '../../src/common/constants';
import { FIXTURE_USER_A, FIXTURE_USER_B, FIXTURE_USER_C } from '../fixtures/test-data';

describe('Bonus Feature 3: Joi Validation Schemas - Unit Tests', () => {
  describe('createGroupChatSchema', () => {
    it('should accept valid group creation payload and trim name', () => {
      const { error, value } = createGroupChatSchema.validate({
        creatorId: FIXTURE_USER_A.id,
        name: '  Engineering  ',
        memberIds: [FIXTURE_USER_B.id, FIXTURE_USER_C.id],
      });
      expect(error).toBeUndefined();
      expect(value.name).toBe('Engineering');
    });

    it('should reject duplicate member IDs', () => {
      const { error } = createGroupChatSchema.validate({
        creatorId: FIXTURE_USER_A.id,
        name: 'Engineering',
        memberIds: [FIXTURE_USER_B.id, FIXTURE_USER_B.id],
      });
      expect(error?.message).toContain('Duplicate member IDs');
    });

    it('should reject empty memberIds array and invalid UUIDs', () => {
      const emptyErr = createGroupChatSchema.validate({
        creatorId: FIXTURE_USER_A.id,
        name: 'Engineering',
        memberIds: [],
      }).error;
      expect(emptyErr).toBeDefined();

      const uuidErr = createGroupChatSchema.validate({
        creatorId: 'not-a-uuid',
        name: 'Engineering',
        memberIds: ['also-bad'],
      }).error;
      expect(uuidErr).toBeDefined();
    });

    it('should reject whitespace-only or over-length group name and unexpected fields', () => {
      expect(
        createGroupChatSchema.validate({
          creatorId: FIXTURE_USER_A.id,
          name: '    ',
          memberIds: [FIXTURE_USER_B.id],
        }).error,
      ).toBeDefined();

      expect(
        createGroupChatSchema.validate({
          creatorId: FIXTURE_USER_A.id,
          name: 'g'.repeat(GROUP_CONSTANTS.NAME_MAX_LENGTH + 1),
          memberIds: [FIXTURE_USER_B.id],
        }).error,
      ).toBeDefined();

      const extraErr = createGroupChatSchema.validate({
        creatorId: FIXTURE_USER_A.id,
        name: 'Valid Group',
        memberIds: [FIXTURE_USER_B.id],
        unexpectedField: true,
      }).error;
      expect(extraErr?.message).toContain('"unexpectedField" is not allowed');
    });
  });

  describe('addGroupMembersSchema', () => {
    it('should reject duplicates, missing requesterId, and unexpected fields', () => {
      expect(
        addGroupMembersSchema.validate({
          requesterId: FIXTURE_USER_A.id,
          memberIds: [FIXTURE_USER_B.id, FIXTURE_USER_B.id],
        }).error,
      ).toBeDefined();

      expect(
        addGroupMembersSchema.validate({
          memberIds: [FIXTURE_USER_B.id],
        }).error,
      ).toBeDefined();

      expect(
        addGroupMembersSchema.validate({
          requesterId: FIXTURE_USER_A.id,
          memberIds: [FIXTURE_USER_B.id],
          role: 'ADMIN',
        }).error?.message,
      ).toContain('"role" is not allowed');
    });
  });

  describe('removeGroupMemberSchema & removeMemberParamSchema', () => {
    it('should validate param UUIDs, required requesterId, and reject unexpected properties', () => {
      expect(
        removeMemberParamSchema.validate({
          chatId: FIXTURE_USER_A.id,
          memberId: 'invalid-uuid',
        }).error,
      ).toBeDefined();

      expect(removeGroupMemberSchema.validate({}).error).toBeDefined();

      expect(
        removeGroupMemberSchema.validate({
          requesterId: FIXTURE_USER_A.id,
          force: true,
        }).error?.message,
      ).toContain('"force" is not allowed');
    });
  });

  describe('updateGroupSchema', () => {
    it('should reject empty name, missing fields, and unexpected fields', () => {
      expect(
        updateGroupSchema.validate({
          requesterId: FIXTURE_USER_A.id,
          name: '  ',
        }).error,
      ).toBeDefined();

      expect(
        updateGroupSchema.validate({
          requesterId: FIXTURE_USER_A.id,
          name: 'New Name',
          type: 'DIRECT',
        }).error?.message,
      ).toContain('"type" is not allowed');
    });
  });

  describe('editMessageSchema & deleteMessageSchema', () => {
    it('should reject empty text, >2000 char text, missing senderId, and unexpected fields', () => {
      expect(
        editMessageSchema.validate({
          senderId: FIXTURE_USER_A.id,
          text: '   ',
        }).error,
      ).toBeDefined();

      expect(
        editMessageSchema.validate({
          senderId: FIXTURE_USER_A.id,
          text: 'a'.repeat(MESSAGE_CONSTANTS.MAX_LENGTH + 1),
        }).error,
      ).toBeDefined();

      expect(
        editMessageSchema.validate({
          senderId: FIXTURE_USER_A.id,
          text: 'Updated',
          isDeleted: true,
        }).error?.message,
      ).toContain('"isDeleted" is not allowed');

      expect(
        deleteMessageSchema.validate({
          senderId: FIXTURE_USER_A.id,
          hardDelete: true,
        }).error?.message,
      ).toContain('"hardDelete" is not allowed');

      expect(
        messageIdParamSchema.validate({
          chatId: FIXTURE_USER_A.id,
          messageId: '   ',
        }).error,
      ).toBeDefined();
    });

    it('validateBody middleware should reject undefined body rather than bypassing required fields', () => {
      const req = { body: undefined } as unknown as Request;
      const res = {} as Response;
      const next = jest.fn() as jest.MockedFunction<NextFunction>;

      validateBody(deleteMessageSchema)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError));
    });
  });
});
