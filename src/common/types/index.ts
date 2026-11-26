import { ChatMemberRole, ChatType } from '../constants';

export interface ApiResponse<T = unknown> {
  success: true;
  message?: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  errorCode: string;
  errors?: unknown;
}

export interface CursorData {
  timestamp: number; // Unix timestamp in milliseconds
  messageId: string;
}

export interface FirestoreMessageDoc {
  senderId: string;
  text: string;
  isDeleted?: boolean;
  createdAt: { seconds: number; nanoseconds: number } | Date;
  updatedAt: { seconds: number; nanoseconds: number } | Date;
  deletedAt?: { seconds: number; nanoseconds: number } | Date | null;
}

export interface MessageResponse {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  isDeleted?: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  deletedAt?: string | null;
}

export interface PaginatedMessagesResponse {
  messages: MessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReadReceiptDoc {
  userId: string;
  readAt: { seconds: number; nanoseconds: number } | Date;
}

export interface LastSeenDoc {
  userId: string;
  lastSeenMessageId: string;
  lastSeenAt: { seconds: number; nanoseconds: number } | Date;
}

export interface GroupMemberInfo {
  userId: string;
  role: ChatMemberRole;
  joinedAt: string;
}

export interface GroupChatResponse {
  id: string;
  type: ChatType;
  name: string | null;
  createdBy: string | null;
  members: GroupMemberInfo[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface UserChatResponse {
  id: string;
  type: string;
  name?: string | null;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}
