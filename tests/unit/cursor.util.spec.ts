import {
  encodeCursor,
  decodeCursor,
  getCanonicalDirectParticipantKey,
} from '../../src/common/utils';
import { BadRequestError } from '../../src/common/errors';

describe('Cursor & Canonical Utility Functions', () => {
  describe('encodeCursor & decodeCursor', () => {
    it('should correctly encode and decode a valid cursor payload', () => {
      const timestamp = 1700000000123;
      const messageId = 'msg-123456';

      const encoded = encodeCursor(timestamp, messageId);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = decodeCursor(encoded);
      expect(decoded.timestamp).toBe(timestamp);
      expect(decoded.messageId).toBe(messageId);
    });

    it('should handle equal timestamps with distinct message IDs (stable tie-breaker)', () => {
      const timestamp = 1700000000000;
      const msg1 = 'msg-aaa';
      const msg2 = 'msg-bbb';

      const cursor1 = encodeCursor(timestamp, msg1);
      const cursor2 = encodeCursor(timestamp, msg2);

      expect(cursor1).not.toBe(cursor2);

      const decoded1 = decodeCursor(cursor1);
      const decoded2 = decodeCursor(cursor2);

      expect(decoded1.timestamp).toBe(decoded2.timestamp);
      expect(decoded1.messageId).not.toBe(decoded2.messageId);
    });

    it('should throw BadRequestError when cursor string is malformed or invalid base64', () => {
      expect(() => decodeCursor('not-a-valid-base64-json!')).toThrow(BadRequestError);
    });

    it('should throw BadRequestError when cursor payload has invalid structure', () => {
      const invalidJson = Buffer.from(JSON.stringify({ timestamp: 'not-a-number' })).toString(
        'base64url',
      );
      expect(() => decodeCursor(invalidJson)).toThrow(BadRequestError);

      const missingId = Buffer.from(JSON.stringify({ timestamp: 12345 })).toString('base64url');
      expect(() => decodeCursor(missingId)).toThrow(BadRequestError);
    });
  });

  describe('getCanonicalDirectParticipantKey', () => {
    it('should produce identical keys regardless of participant parameter order', () => {
      const userA = 'a0000000-0000-0000-0000-000000000001';
      const userB = 'b0000000-0000-0000-0000-000000000002';

      const key1 = getCanonicalDirectParticipantKey(userA, userB);
      const key2 = getCanonicalDirectParticipantKey(userB, userA);

      expect(key1).toBe(key2);
      expect(key1).toBe(`${userA}_${userB}`);
    });

    it('should normalize uppercase UUIDs to lowercase to prevent casing mismatches', () => {
      const userA = 'A0000000-0000-0000-0000-000000000001';
      const userB = 'b0000000-0000-0000-0000-000000000002';

      const key = getCanonicalDirectParticipantKey(userA, userB);
      expect(key).toBe(`${userA.toLowerCase()}_${userB}`);
    });
  });
});
