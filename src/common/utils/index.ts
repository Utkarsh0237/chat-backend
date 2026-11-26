import { BadRequestError } from '../errors';
import { CursorData } from '../types';

/**
 * Encodes timestamp and message ID into an opaque, URL-safe base64 cursor.
 */
export function encodeCursor(timestamp: number, messageId: string): string {
  const payload: CursorData = { timestamp, messageId };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decodes an opaque base64 cursor back into timestamp and message ID.
 * Throws BadRequestError if the cursor format is malformed.
 */
export function decodeCursor(cursor: string): CursorData {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.timestamp !== 'number' ||
      !Number.isFinite(parsed.timestamp) ||
      typeof parsed.messageId !== 'string' ||
      parsed.messageId.trim() === ''
    ) {
      throw new Error('Invalid cursor structure');
    }

    return {
      timestamp: parsed.timestamp,
      messageId: parsed.messageId,
    };
  } catch {
    throw new BadRequestError('Invalid pagination cursor format');
  }
}

/**
 * Generates a deterministic canonical participant key for a direct chat between two users.
 * Lexicographical sorting guarantees identical keys regardless of participant argument order.
 */
export function getCanonicalDirectParticipantKey(userAId: string, userBId: string): string {
  const sorted = [userAId.toLowerCase(), userBId.toLowerCase()].sort();
  return `${sorted[0]}_${sorted[1]}`;
}
