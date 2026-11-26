import * as admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { MESSAGE_CONSTANTS } from '../../common/constants';
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../common/errors';
import { MessageResponse, PaginatedMessagesResponse } from '../../common/types';
import { encodeCursor } from '../../common/utils';

export class MessageRepository {
  private _db?: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    this._db = db;
  }

  private get db(): admin.firestore.Firestore {
    return this._db || getFirestore();
  }

  private getMessagesCollection(chatId: string): admin.firestore.CollectionReference {
    return this.db.collection('chats').doc(chatId).collection('messages');
  }

  private handleFirestoreError(err: unknown): never {
    if (err instanceof AppError) {
      throw err;
    }
    const fErr = err as { code?: number | string };
    if (fErr.code === 14 || fErr.code === 4 || fErr.code === 'unavailable') {
      throw new ServiceUnavailableError('Firestore is currently unreachable');
    }
    throw err;
  }

  /**
   * Helper to convert Firestore Timestamp or Date into ISO string and milliseconds.
   */
  private parseTimestamp(val: unknown): { iso: string; millis: number } {
    if (!val) {
      const now = new Date();
      return { iso: now.toISOString(), millis: now.getTime() };
    }
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      const d = (val as { toDate: () => Date }).toDate();
      return { iso: d.toISOString(), millis: d.getTime() };
    }
    if (val instanceof Date) {
      return { iso: val.toISOString(), millis: val.getTime() };
    }
    if (typeof (val as { seconds?: number; nanoseconds?: number }).seconds === 'number') {
      const s = (val as { seconds: number; nanoseconds?: number }).seconds;
      const ns = (val as { seconds: number; nanoseconds?: number }).nanoseconds || 0;
      const d = new Date(s * 1000 + Math.floor(ns / 1000000));
      return { iso: d.toISOString(), millis: d.getTime() };
    }
    const d = new Date(String(val));
    return { iso: d.toISOString(), millis: d.getTime() };
  }

  /**
   * Maps a Firestore document snapshot's data into a safe API representation.
   * Ensures deleted messages never leak original content.
   */
  private mapMessageData(
    id: string,
    chatId: string,
    data: admin.firestore.DocumentData,
  ): { publicMessage: MessageResponse; createdAtMillis: number } {
    const isDeleted = Boolean(data.isDeleted);
    const created = this.parseTimestamp(data.createdAt);
    const updated = this.parseTimestamp(data.updatedAt);

    const publicMessage: MessageResponse = {
      id,
      chatId,
      senderId: data.senderId,
      text: isDeleted ? MESSAGE_CONSTANTS.DELETED_PLACEHOLDER : data.text,
      isDeleted,
      createdAt: created.iso,
      updatedAt: updated.iso,
      ...(isDeleted && data.deletedAt
        ? { deletedAt: this.parseTimestamp(data.deletedAt).iso }
        : {}),
    };

    return {
      publicMessage,
      createdAtMillis: created.millis,
    };
  }

  /**
   * Saves a message to Firestore under chats/{chatId}/messages/{messageId}
   */
  async createMessage(chatId: string, senderId: string, text: string): Promise<MessageResponse> {
    try {
      const messagesRef = this.getMessagesCollection(chatId);
      const newDocRef = messagesRef.doc();

      const serverTime = admin.firestore.FieldValue.serverTimestamp();
      const messagePayload = {
        senderId,
        text,
        isDeleted: false,
        createdAt: serverTime,
        updatedAt: serverTime,
      };

      await newDocRef.set(messagePayload);

      // Read back the committed snapshot so callers receive Firestore's authoritative serverTimestamp
      const createdSnap = await newDocRef.get();
      const savedData = createdSnap.exists ? createdSnap.data() : undefined;
      if (savedData) {
        return this.mapMessageData(newDocRef.id, chatId, savedData).publicMessage;
      }

      const nowIso = new Date().toISOString();
      return {
        id: newDocRef.id,
        chatId,
        senderId,
        text,
        isDeleted: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } catch (err) {
      this.handleFirestoreError(err);
    }
  }

  /**
   * Retrieves a single message document by ID from Firestore.
   */
  async findMessageById(
    chatId: string,
    messageId: string,
  ): Promise<(MessageResponse & { createdAtMillis: number }) | null> {
    try {
      const docRef = this.getMessagesCollection(chatId).doc(messageId);
      const snap = await docRef.get();

      if (!snap.exists) {
        return null;
      }

      const data = snap.data();
      if (!data) return null;

      const mapped = this.mapMessageData(snap.id, chatId, data);
      return {
        ...mapped.publicMessage,
        createdAtMillis: mapped.createdAtMillis,
      };
    } catch (err) {
      this.handleFirestoreError(err);
    }
  }

  /**
   * Retrieves messages with cursor-based pagination and deterministic stable tie-breaker.
   * Orders by createdAt ASC, and documentId (admin.firestore.FieldPath.documentId()) ASC.
   */
  async getMessages(
    chatId: string,
    limit: number,
    cursor?: { timestamp: number; messageId: string },
  ): Promise<PaginatedMessagesResponse> {
    try {
      let query: admin.firestore.Query = this.getMessagesCollection(chatId)
        .orderBy('createdAt', 'asc')
        .orderBy(admin.firestore.FieldPath.documentId(), 'asc');

      if (cursor) {
        const cursorTimestamp = admin.firestore.Timestamp.fromMillis(cursor.timestamp);
        query = query.startAfter(cursorTimestamp, cursor.messageId);
      }

      // Fetch limit + 1 to detect if next page exists
      const snapshot = await query.limit(limit + 1).get();

      if (snapshot.empty) {
        return {
          messages: [],
          nextCursor: null,
          hasMore: false,
        };
      }

      const docs = snapshot.docs;
      const hasMore = docs.length > limit;
      const resultDocs = hasMore ? docs.slice(0, limit) : docs;

      const messages: MessageResponse[] = [];
      let lastDocTimestamp = 0;
      let lastDocId = '';

      for (const doc of resultDocs) {
        const data = doc.data();
        const mapped = this.mapMessageData(doc.id, chatId, data);

        lastDocTimestamp = mapped.createdAtMillis;
        lastDocId = doc.id;
        messages.push(mapped.publicMessage);
      }

      const nextCursor = hasMore && lastDocId ? encodeCursor(lastDocTimestamp, lastDocId) : null;

      return {
        messages,
        nextCursor,
        hasMore,
      };
    } catch (err) {
      this.handleFirestoreError(err);
    }
  }

  /**
   * Bonus Feature 2.1: Atomically edits a message inside a Firestore transaction.
   * Preserves original createdAt, senderId, and readReceipts subcollection.
   * Rejects edits from non-senders and prevents editing already-deleted messages.
   */
  async editMessage(
    chatId: string,
    messageId: string,
    senderId: string,
    newText: string,
  ): Promise<MessageResponse> {
    try {
      const docRef = this.getMessagesCollection(chatId).doc(messageId);
      let preEditData: admin.firestore.DocumentData | undefined;

      await this.db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);

        if (!snap.exists) {
          throw new NotFoundError(
            `Message with id "${messageId}" does not exist in chat "${chatId}"`,
          );
        }

        const data = snap.data();
        if (!data) {
          throw new NotFoundError(
            `Message with id "${messageId}" does not exist in chat "${chatId}"`,
          );
        }

        if (data.senderId !== senderId) {
          throw new ForbiddenError('Only the original sender can edit this message');
        }

        if (data.isDeleted) {
          throw new BadRequestError('Cannot edit a deleted message');
        }

        preEditData = data;
        transaction.update(docRef, {
          text: newText,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Read committed snapshot so original createdAt and authoritative updatedAt match Firestore
      const updatedSnap = await docRef.get();
      const finalData = updatedSnap.exists ? updatedSnap.data() : undefined;
      if (finalData) {
        return this.mapMessageData(messageId, chatId, finalData).publicMessage;
      }

      const created = this.parseTimestamp(preEditData?.createdAt);
      return {
        id: messageId,
        chatId,
        senderId,
        text: newText,
        isDeleted: false,
        createdAt: created.iso,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.handleFirestoreError(err);
    }
  }

  /**
   * Bonus Feature 2.2: Atomically soft-deletes a message inside a Firestore transaction.
   * Preserves document, createdAt, senderId, and readReceipts subcollection.
   * Prevents repeated deletion from mutating original deletedAt/updatedAt timestamps.
   */
  async softDeleteMessage(
    chatId: string,
    messageId: string,
    senderId: string,
  ): Promise<MessageResponse> {
    try {
      const docRef = this.getMessagesCollection(chatId).doc(messageId);
      let existingDeletedData: admin.firestore.DocumentData | null = null;
      let originalCreatedAt: unknown;

      await this.db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);

        if (!snap.exists) {
          throw new NotFoundError(
            `Message with id "${messageId}" does not exist in chat "${chatId}"`,
          );
        }

        const data = snap.data();
        if (!data) {
          throw new NotFoundError(
            `Message with id "${messageId}" does not exist in chat "${chatId}"`,
          );
        }

        if (data.senderId !== senderId) {
          throw new ForbiddenError('Only the original sender can delete this message');
        }

        // Idempotent guard: already deleted messages must not mutate deletedAt or updatedAt
        if (data.isDeleted) {
          existingDeletedData = data;
          return;
        }

        originalCreatedAt = data.createdAt;
        const serverTime = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(docRef, {
          text: MESSAGE_CONSTANTS.DELETED_PLACEHOLDER,
          isDeleted: true,
          deletedAt: serverTime,
          updatedAt: serverTime,
        });
      });

      if (existingDeletedData) {
        return this.mapMessageData(messageId, chatId, existingDeletedData).publicMessage;
      }

      const deletedSnap = await docRef.get();
      const finalData = deletedSnap.exists ? deletedSnap.data() : undefined;
      if (finalData) {
        return this.mapMessageData(messageId, chatId, finalData).publicMessage;
      }

      const nowIso = new Date().toISOString();
      const created = this.parseTimestamp(originalCreatedAt);
      return {
        id: messageId,
        chatId,
        senderId,
        text: MESSAGE_CONSTANTS.DELETED_PLACEHOLDER,
        isDeleted: true,
        createdAt: created.iso,
        updatedAt: nowIso,
        deletedAt: nowIso,
      };
    } catch (err) {
      this.handleFirestoreError(err);
    }
  }
}
