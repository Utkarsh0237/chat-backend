# Chat Backend – Node.js, TypeScript, PostgreSQL & Firestore

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-TypeORM_0.3-4169E1.svg)](https://www.postgresql.org/)
[![Firestore](https://img.shields.io/badge/Firebase-Admin_SDK_12-FFCA28.svg)](https://firebase.google.com/)
[![Tests](https://img.shields.io/badge/Tested_With-Jest_%26_Supertest-C21325.svg)](https://jestjs.io/)

A RESTful chat backend service engineered with **Node.js**, **Express**, **TypeScript** (strict mode), **PostgreSQL** via **TypeORM**, and **Firebase Firestore** via **Firebase Admin SDK**.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [Technology Stack](#3-technology-stack)
4. [Architecture](#4-architecture)
5. [Project Structure](#5-project-structure)
6. [Database Design](#6-database-design)
7. [Firestore Data Model](#7-firestore-data-model)
8. [Message Ordering and Cursor Pagination](#8-message-ordering-and-cursor-pagination)
9. [Read Receipts and Last Seen](#9-read-receipts-and-last-seen)
10. [Installation and Setup](#10-installation-and-setup)
11. [Environment Configuration](#11-environment-configuration)
12. [Running the Application](#12-running-the-application)
13. [API Documentation](#13-api-documentation)
14. [Authentication and Security](#14-authentication-and-security)
15. [Testing](#15-testing)
16. [Known Limitations and Future Improvements](#16-known-limitations-and-future-improvements)

---

## 1. Project Overview

This service implements direct (1-on-1) and group messaging APIs using a **hybrid persistence architecture**:

- **PostgreSQL (via TypeORM)**: Stores relational state requiring foreign keys, unique constraints, and ACID transactions—specifically `users`, `chats`, `chat_members`, group roles (`ADMIN` / `MEMBER`), and `lastActivityAt` metadata for sorted user chat listings.
- **Firebase Firestore (via Firebase Admin SDK)**: Stores append-heavy chat message timelines, edit/soft-delete state, per-message read receipts, and per-user last-seen markers in chat-scoped subcollections.

Splitting relational membership metadata from high-frequency message documents avoids relational row/table bloat on chat timelines while keeping user relationships, membership authorization, and direct-chat uniqueness enforced in PostgreSQL.

---

## 2. Features

- **Direct Chat Deduplication**: Deterministic canonical participant keys (`${minUuid}_${maxUuid}`) backed by a PostgreSQL unique index prevent duplicate 1-on-1 chats under concurrent creation requests.
- **Group Chat Management**: Create `GROUP` chats (`canonicalParticipants = NULL`), enroll the creator as `ADMIN`, add/remove members, leave groups, and rename groups inside row-locked (`pessimistic_write`) PostgreSQL transactions with last-admin protection.
- **Transactional Message Lifecycle**: Send messages (`FieldValue.serverTimestamp()`), edit message text, and soft-delete messages inside Firestore transactions (`runTransaction`), preserving `createdAt`, ordering, and `readReceipts` while masking deleted text (`"This message was deleted"`).
- **Synchronized Chat Activity Tracking**: `MessageRepository.createMessage` reads back Firestore's committed server timestamp (`docRef.get()`), and PostgreSQL updates `chats.lastActivityAt` with an atomic monotonic conditional `UPDATE` so out-of-order concurrent requests do not regress newer activity timestamps.
- **Composite Cursor Pagination**: Chronological message retrieval ordered by `(createdAt ASC, FieldPath.documentId() ASC)` with URL-safe Base64 cursors to break millisecond timestamp ties.
- **Idempotent Read Receipts & Non-Regressive Last Seen**: Per-user read receipts (`{ merge: true }`), self-read rejection (`400 Bad Request`), and transactional last-seen validation preventing backward movement.
- **Single-Query Chat Listing**: Fetches a user's chats and all participant IDs in one SQL query via `INNER JOIN` filtering and `LEFT JOIN` eager loading ordered by `lastActivityAt DESC`.
- **Fail-Closed Production Auth & Membership Checks**: Strict HS256 JWT verification (`AUTH_REQUIRED=true`), anti-spoofing actor enforcement, development-only user creation (`POST /user`), and active membership authorization across both `DIRECT` and `GROUP` chats.

---

## 3. Technology Stack

| Component               | Technology                       | Version / Role                                                     |
| :---------------------- | :------------------------------- | :----------------------------------------------------------------- |
| **Runtime**             | Node.js                          | `>=18.0.0`                                                         |
| **Language**            | TypeScript                       | `^5.7.3` (`strict: true`, `noImplicitAny: true`)                   |
| **HTTP Framework**      | Express.js                       | `^4.21.2`                                                          |
| **Relational Database** | PostgreSQL (`pg`)                | `^8.13.1` with TypeORM `^0.3.20` Data Mapper & migrations          |
| **Document Store**      | Cloud Firestore                  | `firebase-admin` `^12.7.0`                                         |
| **Validation**          | Joi                              | `^17.13.3` for request payloads and startup env config             |
| **HTTP Security**       | Helmet, CORS, Express Rate Limit | Security headers, origin controls, IP rate limiting                |
| **Testing**             | Jest & Supertest                 | Unit tests (mocked/in-memory) and HTTP integration tests           |
| **Tooling**             | ESLint & Prettier                | `@typescript-eslint/no-explicit-any: error`, consistent formatting |

---

## 4. Architecture

The codebase follows a layered **Controller -> Service -> Repository** architecture with explicit dependency injection defaults for unit testing:

```text
Client Request
      │
      ▼
Express Pipeline (helmet -> cors -> rateLimit -> json(1mb) -> authenticate)
      │
      ▼
Routes & Joi Validation Middleware (validateParams / validateQuery / validateBody)
      │
      ▼
Controllers (extract params/body, enforceAuthenticatedActor, format HTTP responses)
      │
      ▼
Domain Services (ChatService, MessageService, ReadReceiptService, UserService)
      ├────────────────────────────────────┬────────────────────────────────────┐
      ▼                                    ▼                                    │
PostgreSQL Repositories              Firestore Repositories                     │
(TypeORM DataSource / QueryRunner)   (Firebase Admin SDK / runTransaction)      │
  - users                              - chats/{chatId}/messages/{messageId}    │
  - chats                              - .../readReceipts/{userId}              │
  - chat_members                       - chats/{chatId}/lastSeen/{userId}       │
      │                                    │                                    │
      └────────────────────────────────────┴────────────────────────────────────┘
                                           │
                                           ▼
                       Centralized Error Middleware (errorHandler)
```

### Centralized Error Mapping

Runtime errors extend `AppError` or are mapped centrally in [`src/middleware/error.middleware.ts`](src/middleware/error.middleware.ts):

| Error Condition                                                                                                                                         | HTTP Status | `errorCode`             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------- | :---------------------- |
| Validation error, self-chat, invalid cursor, self-read, last-seen regression, edit deleted msg, remove last admin, malformed JSON, PG `23503` / `22P02` | `400`       | `BAD_REQUEST`           |
| Missing/invalid/expired JWT (`AUTH_REQUIRED=true`), missing requester identity on message read                                                          | `401`       | `UNAUTHORIZED`          |
| Non-member access, non-admin group mutation, non-sender edit/delete, JWT/actor mismatch, `POST /user` outside dev mode                                  | `403`       | `FORBIDDEN`             |
| Missing user/chat/member/message, unknown HTTP route (`notFoundHandler`)                                                                                | `404`       | `NOT_FOUND`             |
| Duplicate email, user already in group, PostgreSQL `23505` unique violation                                                                             | `409`       | `CONFLICT`              |
| IP rate limit threshold exceeded (`express-rate-limit`)                                                                                                 | `429`       | `RATE_LIMIT_EXCEEDED`   |
| Firestore gRPC `14` (`UNAVAILABLE`), `4` (`DEADLINE_EXCEEDED`), or `'unavailable'`                                                                      | `503`       | `SERVICE_UNAVAILABLE`   |
| Unhandled unexpected errors (message redacted outside `development`)                                                                                    | `500`       | `INTERNAL_SERVER_ERROR` |

---

## 5. Project Structure

```text
chat-system/
├── src/
│   ├── app.ts                          # Express app factory (security, auth, routes, errors)
│   ├── server.ts                       # DB/Firebase bootstrap and SIGINT/SIGTERM shutdown
│   ├── common/
│   │   ├── constants/index.ts          # Message/group/pagination limits, roles, error codes
│   │   ├── errors/index.ts             # AppError hierarchy (400, 401, 403, 404, 409, 500, 503)
│   │   ├── types/index.ts              # Request/response DTOs and Firestore doc types
│   │   └── utils/index.ts              # Cursor encode/decode & canonical participant key
│   ├── config/
│   │   ├── database.ts                 # TypeORM AppDataSource and lifecycle helpers
│   │   ├── env.ts                      # Joi environment validation (fail-closed production)
│   │   └── firebase.ts                 # Firebase Admin SDK initialization (cert / base64 / emulator)
│   ├── entities/                       # TypeORM entities (User, Chat, ChatMember)
│   ├── middleware/
│   │   ├── auth.middleware.ts          # HS256 JWT verification, dev mode, actor guards
│   │   ├── error.middleware.ts         # AppError, PG, Firestore, and fallback handler
│   │   ├── not-found.middleware.ts     # JSON 404 handler
│   │   └── validation.middleware.ts    # Joi body/params/query middleware
│   ├── migrations/
│   │   ├── 1700000000000-InitialMigration.ts
│   │   └── 1700000001000-AddGroupChatSupport.ts
│   ├── modules/
│   │   ├── chat/                       # Direct/group chat routes, controller, service, repo, Joi
│   │   ├── message/                    # Message send/list/edit/delete service, repo, Joi
│   │   ├── read-receipt/               # Read receipt & last-seen controller, service, repo, Joi
│   │   └── user/                       # User provisioning/lookup routes, controller, service, repo, Joi
│   └── routes/index.ts                 # /health, /chat, /user router aggregation
├── scripts/
│   └── seed.ts                         # Optional seed script (4 fixture users + 1 direct chat)
├── tests/
│   ├── fixtures/test-data.ts           # Deterministic UUID fixtures
│   ├── setup.ts                        # Jest env bootstrap (loads .env, maps test -> development)
│   ├── unit/                           # 11 unit test suites (services, repos, Joi, auth, middleware)
│   └── integration/                    # 3 Supertest API suites (core, bonus/security, timestamp sync)
├── .env.example                        # Safe environment template
├── .eslintrc.json                      # ESLint configuration
├── .gitignore                          # Excludes .env, serviceAccountKey*.json, dist, coverage
├── .prettierrc                         # Prettier formatting configuration
├── jest.config.js                      # Jest & ts-jest configuration
├── ormconfig.ts                        # TypeORM CLI DataSource entry point
├── package.json                        # Scripts and dependencies
├── postman_collection.json             # Postman collection (15 endpoints + Bearer token variable)
└── tsconfig.json                       # Strict TypeScript compiler options
```

---

## 6. Database Design

PostgreSQL tables are managed via explicit TypeORM migrations (`DB_SYNCHRONIZE=false`):

### Tables

1. **`users`**
   - `id` (`UUID`, PK, `gen_random_uuid()`)
   - `name` (`VARCHAR(255)`, NOT NULL)
   - `email` (`VARCHAR(255)`, NOT NULL, UNIQUE, `IDX_users_email`)
   - `createdAt`, `updatedAt` (`TIMESTAMPTZ`, DEFAULT `now()`)

2. **`chats`**
   - `id` (`UUID`, PK, `gen_random_uuid()`)
   - `type` (`VARCHAR(50)`, NOT NULL, DEFAULT `'DIRECT'`, `IDX_chats_type`) — `'DIRECT'` or `'GROUP'`
   - `name` (`VARCHAR(100)`, NULL) — populated for `GROUP` chats
   - `createdBy` (`UUID`, NULL, FK -> `users(id)` ON DELETE SET NULL)
   - `canonicalParticipants` (`VARCHAR(100)`, NULL, UNIQUE, `IDX_chats_canonicalParticipants`)
   - `lastActivityAt` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`, `IDX_chats_lastActivityAt`)
   - `createdAt`, `updatedAt` (`TIMESTAMPTZ`, DEFAULT `now()`)

3. **`chat_members`**
   - `id` (`UUID`, PK, `gen_random_uuid()`)
   - `chatId` (`UUID`, NOT NULL, FK -> `chats(id)` ON DELETE CASCADE, `IDX_chat_members_chatId`)
   - `userId` (`UUID`, NOT NULL, FK -> `users(id)` ON DELETE CASCADE, `IDX_chat_members_userId`)
   - `role` (`VARCHAR(20)`, NOT NULL, DEFAULT `'MEMBER'`, `IDX_chat_members_chatId_role`) — `'ADMIN'` or `'MEMBER'`
   - `joinedAt` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`)
   - Unique constraint: `UQ_chat_members_chatId_userId` (`(chatId, userId)`)

### Concurrent Direct Chat Deduplication

To prevent duplicate 1-on-1 chats regardless of request order or concurrency:

1. [`getCanonicalDirectParticipantKey`](src/common/utils/index.ts#L45-L48) normalizes both UUIDs to lowercase, sorts them lexicographically, and produces `${minUuid}_${maxUuid}`.
2. [`ChatRepository.createDirectChatWithTransaction`](src/modules/chat/chat.repository.ts#L83-L141) checks for an existing row and otherwise opens a database transaction to insert into `chats` and `chat_members`.
3. If two concurrent transactions attempt to insert the same pair simultaneously, PostgreSQL's `UNIQUE` index rejects the losing insert with error code `23505`.
4. The repository rolls back the losing transaction and queries/returns the winning `chat` row (`isNew: false`).

Unlike `DIRECT` chats, `GROUP` chats store `canonicalParticipants = NULL`, allowing separate groups with identical participants and names. Group mutations (`addGroupMembersWithTransaction`, `removeGroupMemberWithTransaction`, `updateGroupWithTransaction`) lock the target `chats` row (`pessimistic_write` / `SELECT ... FOR UPDATE`) to serialize role checks, duplicate-member checks, and last-admin protection.

### Authoritative `lastActivityAt` Synchronization

1. [`MessageRepository.createMessage`](src/modules/message/message.repository.ts#L100-L136) writes `FieldValue.serverTimestamp()` to Firestore and immediately reads back the committed snapshot (`await newDocRef.get()`), extracting Firestore's resolved `createdAt` timestamp instead of using Node's local clock.
2. [`MessageService.sendMessage`](src/modules/message/message.service.ts#L33-L48) passes `new Date(savedMessage.createdAt)` to `ChatService.recordActivity`.
3. [`ChatRepository.updateLastActivity`](src/modules/chat/chat.repository.ts#L67-L77) updates PostgreSQL atomically with a monotonic predicate:
   `WHERE id = :chatId AND ("lastActivityAt" IS NULL OR "lastActivityAt" < :activityDate)`.
   If an earlier message's activity update arrives after a newer message already committed, `0` rows are updated and `lastActivityAt` never moves backwards.
4. `ChatService.recordActivity` catches PostgreSQL update errors so a committed Firestore message is not failed by a transient PostgreSQL hiccup (see [Known Limitations](#16-known-limitations-and-future-improvements)).

---

## 7. Firestore Data Model

```text
chats/ (Collection)
  └── {chatId}/ (Document)
        ├── messages/ (Subcollection)
        │     └── {messageId}/ (Document)
        │           ├── senderId: string (UUID)
        │           ├── text: string (1–2000 chars, or "This message was deleted")
        │           ├── isDeleted: boolean
        │           ├── createdAt: Timestamp (serverTimestamp)
        │           ├── updatedAt: Timestamp (serverTimestamp)
        │           ├── deletedAt?: Timestamp (set once on soft delete)
        │           └── readReceipts/ (Subcollection)
        │                 └── {userId}/ (Document)
        │                       ├── userId: string (UUID)
        │                       └── readAt: Timestamp (serverTimestamp)
        └── lastSeen/ (Subcollection)
              └── {userId}/ (Document)
                    ├── userId: string (UUID)
                    ├── lastSeenMessageId: string
                    └── lastSeenAt: Timestamp (serverTimestamp)
```

### Editing and Soft Deletion Guarantees

- Both [`editMessage`](src/modules/message/message.repository.ts#L230-L291) and [`softDeleteMessage`](src/modules/message/message.repository.ts#L298-L369) check PostgreSQL chat membership first, then run inside a Firestore transaction (`runTransaction`).
- Only the original sender (`data.senderId === senderId`) may edit or delete (`403 Forbidden` otherwise).
- Edits fail with `400 Bad Request` if `data.isDeleted` is already `true`.
- Soft deletion overwrites `text` with `"This message was deleted"`, sets `isDeleted: true`, writes `deletedAt` and `updatedAt` with `serverTimestamp()`, leaves the document, `createdAt`, `senderId`, and `readReceipts` intact (so cursor pagination and receipt history remain consistent), and returns the existing state idempotently without mutating `deletedAt` or `updatedAt` on repeated delete calls.

---

## 8. Message Ordering and Cursor Pagination

Relying solely on `createdAt` causes pagination ambiguity when multiple messages share the same timestamp. [`MessageRepository.getMessages`](src/modules/message/message.repository.ts#L170-L223) prevents tie collisions as follows:

1. Queries Firestore ordered by two fields:
   ```ts
   collection.orderBy('createdAt', 'asc').orderBy(admin.firestore.FieldPath.documentId(), 'asc');
   ```
2. When `cursor` is provided, [`decodeCursor`](src/common/utils/index.ts#L16-L39) decodes the URL-safe Base64 JSON payload `{ "timestamp": <ms>, "messageId": "<id>" }` (rejecting malformed cursors with `400 Bad Request`) and applies `.startAfter(Timestamp.fromMillis(cursor.timestamp), cursor.messageId)`.
3. Fetches `limit + 1` documents (`1 <= limit <= 100`, default `50`). If `docs.length > limit`, `hasMore` is `true`, the extra document is trimmed, and `nextCursor` is encoded from the last returned message's `(createdAtMillis, id)`.

> **Note**: Messages are ordered sequentially across committed `createdAt` timestamps. While composite cursors prevent duplicate or skipped records across stable pages of historical messages, pagination remains subject to Firestore's snapshot/query semantics if new historical timestamps were ever injected prior to a cursor.

---

## 9. Read Receipts and Last Seen

- **Read Receipts (`POST /chat/:chatId/message/:messageId/read`)**:
  - Verifies active chat membership (`403`), message existence (`404`), and blocks self-reads (`message.senderId === userId` -> `400 Bad Request`).
  - Writes `chats/{chatId}/messages/{messageId}/readReceipts/{userId}` with `{ merge: true }` so repeated calls are idempotent.
- **Last Seen (`POST /chat/:chatId/lastseen`)**:
  - [`ReadReceiptRepository.updateLastSeenAtomic`](src/modules/read-receipt/read-receipt.repository.ts#L91-L163) executes a Firestore `runTransaction` comparing `(targetMillis, targetMessage.id)` against the currently recorded `lastSeenMessageId`'s `(currentMillis, currentLastSeenMessageId)`.
  - If the candidate message is earlier (`targetMillis < currentMillis`, or equal timestamps with `targetMessage.id < currentLastSeenMessageId`), it throws `400 Bad Request` (`"Cannot move last seen backwards to an older message"`).
  - Sending the same `messageId` is idempotent.

---

## 10. Installation and Setup

### Prerequisites

- **Node.js** `>= 18.0.0` and **npm**
- **PostgreSQL** (`>= 14` recommended, `pgcrypto` extension enabled by `InitialMigration`)
- **Firebase Cloud Firestore** project (with a Service Account JSON key) **or** local **Firebase Firestore Emulator**

### Setup Steps

```bash
# 1. Clone the repository
git clone <repository-url>
cd chat-system

# 2. Install dependencies
npm install

# 3. Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE chat_system;"

# 4. Create local environment file from safe template
cp .env.example .env
```

### Firebase Credential Configuration

Configure one of the following options in `.env`:

- **Option A — Local Firestore Emulator (recommended for isolated local testing)**:
  ```env
  FIRESTORE_EMULATOR_HOST=localhost:8080
  FIREBASE_PROJECT_ID=demo-chat-system
  FIREBASE_SERVICE_ACCOUNT_KEY_PATH=
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=
  ```
- **Option B — Service Account JSON File (Cloud Firestore)**:
  Place your downloaded service account JSON at `./serviceAccountKey.json` (gitignored):
  ```env
  FIRESTORE_EMULATOR_HOST=
  FIREBASE_PROJECT_ID=<your-firebase-project-id>
  FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./serviceAccountKey.json
  ```
- **Option C — Base64 Service Account JSON**:
  ```env
  FIREBASE_PROJECT_ID=<your-firebase-project-id>
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=<base64-encoded-json>
  ```

### Migrations & Optional Seed Data

```bash
# Run PostgreSQL TypeORM migrations
npm run migration:run

# (Optional) Seed 4 fixture users (Alice, Bob, Charlie, Diana) and 1 direct chat
npm run seed
```

Revert the most recent migration if needed:

```bash
npm run migration:revert
```

---

## 11. Environment Configuration

Environment variables are validated at startup in [`src/config/env.ts`](src/config/env.ts) using Joi:

| Variable                              | Schema Default (`env.ts`) | `.env.example`    | Description                                                                       |
| :------------------------------------ | :------------------------ | :---------------- | :-------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `'development'`           | `development`     | `'development'` or `'production'`                                                 |
| `PORT`                                | `3000`                    | `3000`            | HTTP listen port                                                                  |
| `API_PREFIX`                          | `""`                      | `/api/v1`         | Optional secondary route prefix (routes always mount at `/` too)                  |
| `DB_HOST`                             | `'localhost'`             | `localhost`       | PostgreSQL host                                                                   |
| `DB_PORT`                             | `5432`                    | `5432`            | PostgreSQL port                                                                   |
| `DB_USERNAME`                         | `'postgres'`              | `postgres`        | PostgreSQL username                                                               |
| `DB_PASSWORD`                         | `'postgres'`              | `postgres`        | PostgreSQL password                                                               |
| `DB_NAME`                             | `'chat_system'`           | `chat_system`     | PostgreSQL database name                                                          |
| `DB_LOGGING`                          | `false`                   | `false`           | TypeORM SQL logging                                                               |
| `DB_SYNCHRONIZE`                      | `false`                   | `false`           | Must stay `false`; use migrations                                                 |
| `FIREBASE_PROJECT_ID`                 | `'demo-chat-system'`      | `chat-system-dev` | Firebase / GCP project ID                                                         |
| `FIRESTORE_EMULATOR_HOST`             | `undefined`               | `""`              | Host:port for Firestore Emulator (e.g. `localhost:8080`)                          |
| `FIREBASE_SERVICE_ACCOUNT_KEY_PATH`   | `undefined`               | `""`              | Path to service account JSON key                                                  |
| `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` | `undefined`               | `""`              | Base64-encoded service account JSON key                                           |
| `CORS_ORIGIN`                         | `'*'` (dev)               | `*`               | Allowed origins. **Production fails startup if missing or `*`**                   |
| `RATE_LIMIT_WINDOW_MS`                | `900000`                  | `900000`          | Rate limit window in milliseconds                                                 |
| `RATE_LIMIT_MAX_REQUESTS`             | `1000`                    | `100`             | Max requests per IP per window                                                    |
| `AUTH_REQUIRED`                       | `false` (dev)             | `false`           | Require HS256 Bearer JWT. **Production fails startup unless `true`**              |
| `JWT_SECRET`                          | `""` (dev w/ auth off)    | placeholder       | >=32 char non-default secret. Required in production or when `AUTH_REQUIRED=true` |

---

## 12. Running the Application

```bash
# Development server (ts-node)
npm run dev

# Build TypeScript output to dist/
npm run build

# Start compiled production bundle (requires NODE_ENV=production env vars when run in prod)
npm run start
```

Available quality scripts from [`package.json`](package.json):

```bash
npm run format        # Format src/**/*.ts and tests/**/*.ts with Prettier
npm run format:check  # Verify formatting
npm run typecheck     # Run tsc --noEmit
npm run lint          # Run ESLint across src/ and tests/
```

---

## 13. API Documentation

> **Route Mounting**: All routes mount at `/` by default (and also at `API_PREFIX` when configured, e.g. `/api/v1`).
> **Collection**: Import [`postman_collection.json`](postman_collection.json) (includes collection-level `Bearer {{authToken}}` auth for protected endpoints and `noauth` on public/dev endpoints).

### Endpoint Access Summary

| Method & Route                               | Purpose                          | Auth Mode Behavior                                                              |
| :------------------------------------------- | :------------------------------- | :------------------------------------------------------------------------------ |
| `GET /health`                                | Server health status             | Public                                                                          |
| `POST /user`                                 | Create user account              | **Development-only** (`403` when `AUTH_REQUIRED=true` or `NODE_ENV=production`) |
| `GET /user/:userId`                          | Get user by UUID                 | Protected (`sub === userId` when `AUTH_REQUIRED=true`)                          |
| `POST /chat/create`                          | Create or retrieve direct chat   | Protected (`sub` must equal `userAId` or `userBId` when `AUTH_REQUIRED=true`)   |
| `POST /chat/group/create`                    | Create group chat                | Protected (`sub === creatorId` when `AUTH_REQUIRED=true`)                       |
| `POST /chat/:chatId/members`                 | Add group members                | Protected (`ADMIN` member only)                                                 |
| `DELETE /chat/:chatId/members/:memberId`     | Remove member / leave group      | Protected (`ADMIN` removes others; any member may leave; last admin blocked)    |
| `PATCH /chat/:chatId/group`                  | Update group name                | Protected (`ADMIN` member only)                                                 |
| `POST /chat/:chatId/message/send`            | Send message to chat             | Protected (active `DIRECT`/`GROUP` member)                                      |
| `GET /chat/:chatId/messages`                 | List messages (cursor paginated) | Protected (requires user identity + active `DIRECT`/`GROUP` membership)         |
| `PATCH /chat/:chatId/message/:messageId`     | Edit own message                 | Protected (active member + original `senderId`)                                 |
| `DELETE /chat/:chatId/message/:messageId`    | Soft-delete own message          | Protected (active member + original `senderId`)                                 |
| `POST /chat/:chatId/message/:messageId/read` | Mark message as read             | Protected (active member + `senderId !== userId`)                               |
| `POST /chat/:chatId/lastseen`                | Update non-regressive last seen  | Protected (active member)                                                       |
| `GET /user/:userId/chats`                    | List user's chats by activity    | Protected (`sub === userId` when `AUTH_REQUIRED=true`)                          |

> **Body Identity Hydration (`AUTH_REQUIRED=true`)**: Protected write endpoints automatically hydrate omitted body actor fields (`senderId`, `userId`, `creatorId`, `requesterId`) from the verified JWT `sub`. If explicitly supplied with a different UUID, the request is rejected with `403 Forbidden`. On `DELETE /chat/:chatId/members/:memberId` and `DELETE /chat/:chatId/message/:messageId`, `X-User-Id` is also hydrated in dev mode when body identity is omitted.

---

### Health & User Endpoints

#### `GET /health`

- **Purpose**: Liveness and uptime check.
- **Auth**: Public.
- **Response (`200 OK`)**:
  ```json
  {
    "status": "ok",
    "uptime": 12.34,
    "timestamp": "2026-11-26T18:00:00.000Z"
  }
  ```

#### `POST /user`

- **Purpose**: Provision a user in PostgreSQL for local development/testing.
- **Auth**: Development-only (`AUTH_REQUIRED=false` and `NODE_ENV=development`).
- **Request Body**: `{ "name": "Alice Johnson", "email": "alice@example.com" }` (`name` 1–255 chars, valid email; lowercased on save).
- **Success (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "id": "a0000000-0000-0000-0000-000000000001",
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "createdAt": "2026-11-26T18:00:00.000Z",
      "updatedAt": "2026-11-26T18:00:00.000Z"
    }
  }
  ```
- **Errors**: `400` invalid payload, `403` disabled when `AUTH_REQUIRED=true` or `NODE_ENV=production`, `409` duplicate email.

#### `GET /user/:userId`

- **Purpose**: Fetch a single user record by UUID.
- **Auth**: Protected (`sub === userId` when `AUTH_REQUIRED=true`).
- **Params**: `userId` (UUID).
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "a0000000-0000-0000-0000-000000000001",
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "createdAt": "2026-11-26T18:00:00.000Z",
      "updatedAt": "2026-11-26T18:00:00.000Z"
    }
  }
  ```
- **Errors**: `400` invalid UUID, `401` invalid/missing JWT, `403` actor mismatch, `404` user not found.

---

### Core Chat & Messaging Endpoints (APIs 1–6)

#### API 1: `POST /chat/create`

- **Purpose**: Create a direct chat between two users or return the existing one idempotently.
- **Auth**: Protected (`sub` must match `userAId` or `userBId` when `AUTH_REQUIRED=true`).
- **Request Body**: `{ "userAId": "<uuid>", "userBId": "<uuid>" }` (distinct UUIDs).
- **Success (`201 Created` if `isNew: true`, `200 OK` if `isNew: false`)**:
  ```json
  {
    "success": true,
    "data": {
      "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
      "isNew": true
    }
  }
  ```
- **Errors**: `400` identical or invalid UUIDs, `401`/`403` auth failure, `404` nonexistent user.

#### API 2: `POST /chat/:chatId/message/send`

- **Purpose**: Persist a message in Firestore and sync `chats.lastActivityAt` in PostgreSQL.
- **Auth**: Protected (active member of `chatId`; `senderId` hydrated/verified under JWT).
- **Request Body**: `{ "senderId": "<uuid>", "text": "Hello Bob!" }` (`text` trimmed, 1–2000 chars).
- **Success (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Message sent successfully",
    "data": {
      "id": "doc_abc123",
      "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
      "senderId": "a0000000-0000-0000-0000-000000000001",
      "text": "Hello Bob!",
      "isDeleted": false,
      "createdAt": "2026-11-26T18:01:00.000Z",
      "updatedAt": "2026-11-26T18:01:00.000Z"
    }
  }
  ```
- **Errors**: `400` empty/oversized text, `401` unauthenticated, `403` non-member or actor mismatch, `404` chat not found, `503` Firestore unavailable.

#### API 3: `GET /chat/:chatId/messages`

- **Purpose**: Retrieve paginated messages in ascending chronological order.
- **Auth**: Protected on **both `DIRECT` and `GROUP` chats**. Provide Bearer JWT (`AUTH_REQUIRED=true`), or `X-User-Id` header / `?userId=<uuid>` in development (`AUTH_REQUIRED=false`).
- **Query Params**: `limit` (optional integer `1–100`, default `50`), `cursor` (optional Base64 token), `userId` (optional UUID; must match JWT `sub` when `AUTH_REQUIRED=true`).
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "messages": [
        {
          "id": "doc_abc123",
          "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
          "senderId": "a0000000-0000-0000-0000-000000000001",
          "text": "Hello Bob!",
          "isDeleted": false,
          "createdAt": "2026-11-26T18:01:00.000Z",
          "updatedAt": "2026-11-26T18:01:00.000Z"
        }
      ],
      "nextCursor": null,
      "hasMore": false
    }
  }
  ```
- **Errors**: `400` invalid limit/cursor/UUID, `401` missing identity, `403` non-member or query mismatch, `404` chat not found, `503` Firestore unavailable.

#### API 4: `POST /chat/:chatId/message/:messageId/read`

- **Purpose**: Record an idempotent per-user read receipt on another member's message.
- **Auth**: Protected (active member; `userId` hydrated/verified under JWT).
- **Request Body**: `{ "userId": "<uuid>" }`.
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Message marked as read",
    "data": {
      "messageId": "doc_abc123",
      "userId": "b0000000-0000-0000-0000-000000000002",
      "readAt": "2026-11-26T18:02:00.000Z"
    }
  }
  ```
- **Errors**: `400` self-read or invalid UUID, `401`/`403` auth or non-member, `404` chat or message not found, `503` Firestore unavailable.

#### API 5: `POST /chat/:chatId/lastseen`

- **Purpose**: Advance a member's last-seen message pointer atomically (non-regressive).
- **Auth**: Protected (active member; `userId` hydrated/verified under JWT).
- **Request Body**: `{ "userId": "<uuid>", "messageId": "<messageId>" }`.
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Last seen updated successfully",
    "data": {
      "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
      "userId": "b0000000-0000-0000-0000-000000000002",
      "lastSeenMessageId": "doc_abc123",
      "lastSeenAt": "2026-11-26T18:02:30.000Z"
    }
  }
  ```
- **Errors**: `400` backward movement to older message or invalid input, `401`/`403` auth or non-member, `404` chat or message not found, `503` Firestore unavailable.

#### API 6: `GET /user/:userId/chats`

- **Purpose**: List all direct and group chats for a user sorted by `lastActivityAt DESC`.
- **Auth**: Protected (`sub === userId` when `AUTH_REQUIRED=true`).
- **Params**: `userId` (UUID).
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
        "type": "DIRECT",
        "name": null,
        "memberIds": [
          "a0000000-0000-0000-0000-000000000001",
          "b0000000-0000-0000-0000-000000000002"
        ],
        "createdAt": "2026-11-26T18:00:00.000Z",
        "updatedAt": "2026-11-26T18:01:00.000Z",
        "lastActivityAt": "2026-11-26T18:01:00.000Z"
      }
    ]
  }
  ```
- **Errors**: `400` invalid UUID, `401`/`403` auth failure, `404` user not found.

---

### Group Management Endpoints (APIs 7–10)

All group mutation request bodies reject unknown properties (`.unknown(false)`).

#### API 7: `POST /chat/group/create`

- **Purpose**: Create a new group chat with `creatorId` assigned as `ADMIN`.
- **Auth**: Protected (`sub === creatorId` when `AUTH_REQUIRED=true`).
- **Request Body**: `{ "creatorId": "<uuid>", "name": "Development Team", "memberIds": ["<uuid>", ...] }` (`name` 1–100 chars, `memberIds` 1–500 unique UUIDs; creator is included automatically even if omitted).
- **Success (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Group chat created successfully",
    "data": {
      "id": "6c43e2d1-90b5-47fa-b4f2-6d3c71b18477",
      "type": "GROUP",
      "name": "Development Team",
      "createdBy": "a0000000-0000-0000-0000-000000000001",
      "members": [
        {
          "userId": "a0000000-0000-0000-0000-000000000001",
          "role": "ADMIN",
          "joinedAt": "2026-11-26T18:05:00.000Z"
        },
        {
          "userId": "b0000000-0000-0000-0000-000000000002",
          "role": "MEMBER",
          "joinedAt": "2026-11-26T18:05:00.000Z"
        }
      ],
      "createdAt": "2026-11-26T18:05:00.000Z",
      "updatedAt": "2026-11-26T18:05:00.000Z",
      "lastActivityAt": "2026-11-26T18:05:00.000Z"
    }
  }
  ```
- **Errors**: `400` invalid name / duplicate `memberIds` / unexpected fields, `401`/`403` auth failure, `404` creator or member not found.

#### API 8: `POST /chat/:chatId/members`

- **Purpose**: Add one or more users as `MEMBER`s to a `GROUP` chat.
- **Auth**: Group `ADMIN` only.
- **Request Body**: `{ "requesterId": "<uuid>", "memberIds": ["<uuid>", ...] }` (1–500 unique UUIDs).
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Group members added successfully",
    "data": {
      "chatId": "6c43e2d1-90b5-47fa-b4f2-6d3c71b18477",
      "members": [
        {
          "userId": "a0000000-0000-0000-0000-000000000001",
          "role": "ADMIN",
          "joinedAt": "2026-11-26T18:05:00.000Z"
        },
        {
          "userId": "b0000000-0000-0000-0000-000000000002",
          "role": "MEMBER",
          "joinedAt": "2026-11-26T18:05:00.000Z"
        },
        {
          "userId": "c0000000-0000-0000-0000-000000000003",
          "role": "MEMBER",
          "joinedAt": "2026-11-26T18:06:00.000Z"
        }
      ]
    }
  }
  ```
- **Errors**: `400` direct chat / invalid payload / duplicate IDs, `401`/`403` non-member or non-admin, `404` chat or user missing, `409` user already in group.

#### API 9: `DELETE /chat/:chatId/members/:memberId`

- **Purpose**: Remove a member (by `ADMIN`) or leave a group voluntarily (`requesterId === memberId`).
- **Auth**: Group `ADMIN` (to remove another member) or self (`requesterId === memberId`).
- **Request Body**: `{ "requesterId": "<uuid>" }`.
- **Success (`200 OK`)**: (`message` is `"Left group successfully"` when `requesterId === memberId`, otherwise `"Member removed successfully"`):
  ```json
  {
    "success": true,
    "message": "Member removed successfully",
    "data": {
      "chatId": "6c43e2d1-90b5-47fa-b4f2-6d3c71b18477",
      "removedUserId": "b0000000-0000-0000-0000-000000000002",
      "members": [
        {
          "userId": "a0000000-0000-0000-0000-000000000001",
          "role": "ADMIN",
          "joinedAt": "2026-11-26T18:05:00.000Z"
        }
      ]
    }
  }
  ```
- **Errors**: `400` direct chat or removing/leaving as last `ADMIN`, `401`/`403` non-member or non-admin removing another user, `404` chat or target member not found.

#### API 10: `PATCH /chat/:chatId/group`

- **Purpose**: Rename a `GROUP` chat.
- **Auth**: Group `ADMIN` only.
- **Request Body**: `{ "requesterId": "<uuid>", "name": "Updated Team Name" }` (1–100 chars).
- **Success (`200 OK`)**: Returns standard group object (`type: "GROUP"`, updated `name`, `members`, timestamps) with `"message": "Group information updated successfully"`.
- **Errors**: `400` direct chat or invalid name, `401`/`403` non-member or non-admin, `404` chat not found.

---

### Message Mutation Endpoints (APIs 11–12)

Both endpoints reject unknown body properties (`.unknown(false)`).

#### API 11: `PATCH /chat/:chatId/message/:messageId`

- **Purpose**: Edit the text of a non-deleted message while preserving `createdAt` and `readReceipts`.
- **Auth**: Protected (active member AND original message sender).
- **Request Body**: `{ "senderId": "<uuid>", "text": "Updated message content" }` (1–2000 chars).
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Message updated successfully",
    "data": {
      "id": "doc_abc123",
      "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
      "senderId": "a0000000-0000-0000-0000-000000000001",
      "text": "Updated message content",
      "isDeleted": false,
      "createdAt": "2026-11-26T18:01:00.000Z",
      "updatedAt": "2026-11-26T18:08:00.000Z"
    }
  }
  ```
- **Errors**: `400` empty/oversized text or editing deleted message, `401`/`403` non-member or non-sender, `404` chat or message not found, `503` Firestore unavailable.

#### API 12: `DELETE /chat/:chatId/message/:messageId`

- **Purpose**: Soft-delete a message atomically (`text` replaced by `"This message was deleted"`). Idempotent on repeated calls.
- **Auth**: Protected (active member AND original message sender).
- **Request Body**: `{ "senderId": "<uuid>" }`.
- **Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Message deleted successfully",
    "data": {
      "id": "doc_abc123",
      "chatId": "ff39d329-9646-4a0c-b360-a6e609ae7cff",
      "senderId": "a0000000-0000-0000-0000-000000000001",
      "text": "This message was deleted",
      "isDeleted": true,
      "createdAt": "2026-11-26T18:01:00.000Z",
      "updatedAt": "2026-11-26T18:09:00.000Z",
      "deletedAt": "2026-11-26T18:09:00.000Z"
    }
  }
  ```
- **Errors**: `400` invalid payload, `401`/`403` non-member or non-sender, `404` chat or message not found, `503` Firestore unavailable.

---

## 14. Authentication and Security

### Fail-Closed Production Startup (`src/config/env.ts`)

When `NODE_ENV=production`, startup validation throws an error immediately unless:

- `AUTH_REQUIRED=true`
- `CORS_ORIGIN` is explicitly set to non-wildcard origin(s)
- `JWT_SECRET` is `>= 32` characters and not one of the known weak placeholder defaults

Whenever `AUTH_REQUIRED=true` (even in `development`), `JWT_SECRET` must be configured explicitly (`openssl rand -hex 32`) with no hardcoded fallback.

> **Important**: `AUTH_REQUIRED=false` is strictly for local development and automated test compatibility. Never disable `AUTH_REQUIRED` in production.

### JWT Validation & Anti-Spoofing (`src/middleware/auth.middleware.ts`)

1. **External Token Issuance**: This service does not expose login or token-issuance endpoints. Upstream auth services sign HS256 JWTs for PostgreSQL user UUIDs (`sub`).
2. **HS256 Verification**:
   - Rejects tokens missing 3 segments or with `alg !== 'HS256'` (blocking `alg=none` and asymmetric spoofing).
   - Verifies HMAC-SHA256 signature using constant-time `crypto.timingSafeEqual`.
   - Validates numeric `exp` (`nowSeconds < exp`) and `nbf` (`nowSeconds >= nbf`) claims when present.
   - Requires `sub` to match UUID format.
3. **Actor & Membership Enforcement**:
   - In `AUTH_REQUIRED=true`, `X-User-Id` cannot impersonate a user, and `enforceAuthenticatedActor` rejects any body/query/path user ID not equal to JWT `sub` (`403 Forbidden`).
   - `POST /user` is explicitly blocked (`403 Forbidden`) when `NODE_ENV=production` or `AUTH_REQUIRED=true`.
   - Every chat operation enforces active PostgreSQL `chat_members` membership (`DIRECT` and `GROUP`), and group management requires `role === 'ADMIN'`.

### Generating a Local HS256 Token for Assessment

With `AUTH_REQUIRED=true` and `JWT_SECRET=<your-32+-char-secret>` in `.env`:

```bash
node -e '
  const crypto = require("crypto");
  const secret = process.env.JWT_SECRET;
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({
    sub: "a0000000-0000-0000-0000-000000000001",
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  const s = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  console.log(`${h}.${p}.${s}`);
'
```

### Secret Management

[`.gitignore`](.gitignore) excludes `.env`, `.env.*` (except `.env.example`), `serviceAccountKey*.json`, `*firebase-adminsdk*.json`, `firebase-credentials.json`, `*.pem`, `dist/`, and `coverage/`. Never commit real credentials or `.env` files.

---

## 15. Testing

### Commands

```bash
npm run test:unit          # Unit suites only (tests/unit --runInBand)
npm run test:integration   # End-to-end Supertest suites (tests/integration --runInBand)
npm test                   # Full suite (unit + integration)
npm run test:coverage      # Full suite with coverage output
```

### Test Coverage Map

| Category                                                         | Suites                                                                                                                                                                                                                                                                                                      | Scope Covered                                                                                                                                                                                                                                                                                                                                                                              |
| :--------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit Tests** (`tests/unit`, 11 suites / 122 tests)             | `chat.service.spec.ts`, `group-chat.service.spec.ts`, `message.service.spec.ts`, `message-edit-delete.spec.ts`, `read-receipt.service.spec.ts`, `user-chat.service.spec.ts`, `activity-timestamp.spec.ts`, `bonus-validation.spec.ts`, `cursor.util.spec.ts`, `middleware.spec.ts`, `security-auth.spec.ts` | Isolated business logic, concurrent direct-chat collision recovery, group admin/last-admin guards, transactional edit/soft-delete (via an in-memory Firestore transaction test double), non-regressive last-seen, `serverTimestamp()` snapshot read-back & monotonic Postgres `updateLastActivity`, Joi validation, centralized error mapping, and fail-closed env + HS256 JWT validation. |
| **Integration Tests** (`tests/integration`, 3 suites / 62 tests) | `chat.api.test.ts`, `bonus.api.test.ts`, `activity-timestamp.api.test.ts`                                                                                                                                                                                                                                   | Live HTTP requests via Supertest covering APIs 1–6, concurrent direct chat deduplication, group creation/member/admin workflows, message edit & soft delete, concurrent edit/delete races, strict `AUTH_REQUIRED=true` & JWT/membership authorization regressions, and live Firestore-to-PostgreSQL `lastActivityAt` synchronization under concurrent sends.                               |

### Emulator vs. Live Firestore Warning

- **Firestore Emulator**: Start `firebase emulators:start --only firestore --project demo-chat-system` and set `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env` (no service account key required). Note: emulator execution has **not** been run in this environment; all integration tests in this repository were verified against local PostgreSQL and a live test Cloud Firestore project.
- **Live Cloud Firestore Warning**: Running `npm run test:integration` against a real Firebase project executes real Firestore reads, writes, queries, and `recursiveDelete` operations, consuming Firestore quota. Always point `.env` to a dedicated non-production test project and local PostgreSQL database. Integration tests create uniquely suffixed test records and clean up only those test users and chat documents in `afterEach` / `afterAll`.

---

## 16. Known Limitations and Future Improvements

### Current Limitations

1. **No Distributed Transaction Across PostgreSQL and Firestore**: Writes do not participate in 2-Phase Commit. Messages commit to Firestore first, followed by a best-effort `ChatService.recordActivity` update to PostgreSQL that swallows DB errors so sends do not fail on transient DB hiccups.
2. **No Transactional Outbox or Retry Worker**: Because `recordActivity` does not persist retry jobs, a transient PostgreSQL outage during `sendMessage` can leave `chats.lastActivityAt` stale until a later message succeeds.
3. **Extra Firestore Read on Message Send**: `MessageRepository.createMessage` performs one additional `docRef.get()` read after `set()` to return Firestore's authoritative `serverTimestamp()` rather than local host time.
4. **Locally Generated Read-Receipt & Last-Seen HTTP Response Timestamps**: While Firestore persists `FieldValue.serverTimestamp()`, `ReadReceiptRepository` returns `new Date().toISOString()` in HTTP responses (`readAt` / `lastSeenAt`) without re-reading the committed Firestore snapshot.
5. **Initial Chat Timestamp vs. First-Message Clock Skew**: On `POST /chat/create`, `chats.lastActivityAt` uses local PostgreSQL `now()`. If the local PostgreSQL clock runs slightly ahead of Cloud Firestore's clock when the very first message arrives, the monotonic guard (`"lastActivityAt" < :activityDate`) keeps `lastActivityAt` greater than or equal to the message timestamp rather than moving backwards.
6. **Edits and Soft Deletions Do Not Advance `lastActivityAt`**: Only sending new messages updates `chats.lastActivityAt`.
7. **No Login or JWT-Issuance Endpoint**: Clients must obtain HS256 JWTs from an upstream authentication provider; `POST /user` is intentionally disabled when `AUTH_REQUIRED=true` or `NODE_ENV=production`.
8. **No Chat Deletion or Group Admin Promotion/Demotion Endpoints**: Direct and group chat deletion endpoints are not implemented, and only the initial group creator receives `ADMIN` (removing/leaving as the last admin is blocked).
9. **No Real-Time WebSocket / Push Delivery**: Endpoints are REST-based; live client streaming is not implemented.

### Potential Future Improvements

- **Transactional Outbox / Event Bus**: Publish message-activity events to Kafka, RabbitMQ, or a PostgreSQL outbox worker to guarantee eventual synchronization of `chats.lastActivityAt` and read counters.
- **WebSocket / SSE Gateway**: Add WebSocket delivery (backed by Redis Pub/Sub or Firestore `onSnapshot` listeners) for real-time message fan-out and typing indicators.
- **Admin Promotion & Chat Archival**: Add endpoints for group admin role management (`PATCH /chat/:chatId/members/:memberId`) and soft-archiving chats.
- **Optional Read-Back Consistency for Receipts**: Read back committed timestamps in `ReadReceiptRepository` if strict response parity with Firestore server time is needed.
- **CI Workflow**: Add GitHub Actions running `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, and emulator-backed integration tests.
