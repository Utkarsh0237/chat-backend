import * as admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { ServiceUnavailableError, BadRequestError } from '../../common/errors';

export class ReadReceiptRepository {
  private _db?: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    this._db = db;
  }

  private get db(): admin.firestore.Firestore {
    return this._db || getFirestore();
  }

  private getReadReceiptRef(
    chatId: string,
    messageId: string,
    userId: string,
  ): admin.firestore.DocumentReference {
    return this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .collection('readReceipts')
      .doc(userId);
  }

  private getLastSeenRef(chatId: string, userId: string): admin.firestore.DocumentReference {
    return this.db.collection('chats').doc(chatId).collection('lastSeen').doc(userId);
  }

  /**
   * Helper to parse timestamp into milliseconds
   */
  private parseTimestampToMillis(val: unknown): number {
    if (!val) return 0;
    if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
      return (val as { toMillis: () => number }).toMillis();
    }
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    if (val instanceof Date) {
      return val.getTime();
    }
    if (typeof (val as { seconds?: number }).seconds === 'number') {
      return (val as { seconds: number }).seconds * 1000;
    }
    return new Date(String(val)).getTime();
  }

  /**
   * API 4: Save read receipt idempotently
   */
  async saveReadReceipt(
    chatId: string,
    messageId: string,
    userId: string,
  ): Promise<{ userId: string; readAt: string }> {
    try {
      const docRef = this.getReadReceiptRef(chatId, messageId, userId);
      const serverTime = admin.firestore.FieldValue.serverTimestamp();

      await docRef.set(
        {
          userId,
          readAt: serverTime,
        },
        { merge: true },
      );

      return {
        userId,
        readAt: new Date().toISOString(),
      };
    } catch (err) {
      const fErr = err as { code?: number | string };
      if (fErr.code === 14 || fErr.code === 4 || fErr.code === 'unavailable') {
        throw new ServiceUnavailableError('Firestore is currently unreachable');
      }
      throw err;
    }
  }

  /**
   * API 5: Updates last seen with Firestore transaction and strictly non-regressive ordering.
   * Compares message timestamps and document ID as stable tie-breaker.
   */
  async updateLastSeenAtomic(
    chatId: string,
    userId: string,
    targetMessage: { id: string; createdAtMillis: number },
  ): Promise<{ lastSeenMessageId: string; lastSeenAt: string }> {
    try {
      const lastSeenRef = this.getLastSeenRef(chatId, userId);
      const messagesCol = this.db.collection('chats').doc(chatId).collection('messages');

      let resultTimestamp = new Date().toISOString();

      await this.db.runTransaction(async (transaction) => {
        const lastSeenSnap = await transaction.get(lastSeenRef);

        if (lastSeenSnap.exists) {
          const lastSeenData = lastSeenSnap.data();
          const currentLastSeenMessageId = lastSeenData?.lastSeenMessageId as string | undefined;

          if (currentLastSeenMessageId) {
            // If already at the exact same message, it's idempotent
            if (currentLastSeenMessageId === targetMessage.id) {
              return;
            }

            // Fetch the currently recorded last seen message to compare chronological ordering
            const currentMsgRef = messagesCol.doc(currentLastSeenMessageId);
            const currentMsgSnap = await transaction.get(currentMsgRef);

            if (currentMsgSnap.exists) {
              const currentMsgData = currentMsgSnap.data();
              const currentMsgMillis = this.parseTimestampToMillis(currentMsgData?.createdAt);

              // Compare ordering with tie-breaker:
              // target is OLDER if targetMillis < currentMillis,
              // or if targetMillis === currentMillis and targetMessage.id < currentLastSeenMessageId
              const isTargetOlder =
                targetMessage.createdAtMillis < currentMsgMillis ||
                (targetMessage.createdAtMillis === currentMsgMillis &&
                  targetMessage.id < currentLastSeenMessageId);

              if (isTargetOlder) {
                throw new BadRequestError('Cannot move last seen backwards to an older message');
              }
            }
          }
        }

        // Set the new last seen record
        const serverTime = admin.firestore.FieldValue.serverTimestamp();
        resultTimestamp = new Date().toISOString();

        transaction.set(lastSeenRef, {
          userId,
          lastSeenMessageId: targetMessage.id,
          lastSeenAt: serverTime,
        });
      });

      return {
        lastSeenMessageId: targetMessage.id,
        lastSeenAt: resultTimestamp,
      };
    } catch (err) {
      if (err instanceof BadRequestError) {
        throw err;
      }
      const fErr = err as { code?: number | string };
      if (fErr.code === 14 || fErr.code === 4 || fErr.code === 'unavailable') {
        throw new ServiceUnavailableError('Firestore is currently unreachable');
      }
      throw err;
    }
  }

  /**
   * Retrieves last seen record
   */
  async getLastSeen(
    chatId: string,
    userId: string,
  ): Promise<{ userId: string; lastSeenMessageId: string; lastSeenAt: string } | null> {
    try {
      const snap = await this.getLastSeenRef(chatId, userId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;

      return {
        userId: data.userId,
        lastSeenMessageId: data.lastSeenMessageId,
        lastSeenAt: data.lastSeenAt ? new Date().toISOString() : '',
      };
    } catch (err) {
      const fErr = err as { code?: number | string };
      if (fErr.code === 14 || fErr.code === 4 || fErr.code === 'unavailable') {
        throw new ServiceUnavailableError('Firestore is currently unreachable');
      }
      throw err;
    }
  }
}
