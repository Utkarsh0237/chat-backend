import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1700000000000 implements MigrationInterface {
  name = 'InitialMigration1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp or pgcrypto extension for gen_random_uuid()
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "email" character varying(255) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email");`);

    // Create chats table
    await queryRunner.query(`
      CREATE TABLE "chats" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "type" character varying(50) NOT NULL DEFAULT 'DIRECT',
        "canonicalParticipants" character varying(100),
        "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_chats_canonicalParticipants" UNIQUE ("canonicalParticipants"),
        CONSTRAINT "PK_chats_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_chats_canonicalParticipants" ON "chats" ("canonicalParticipants");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chats_lastActivityAt" ON "chats" ("lastActivityAt");`,
    );

    // Create chat_members table
    await queryRunner.query(`
      CREATE TABLE "chat_members" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "chatId" UUID NOT NULL,
        "userId" UUID NOT NULL,
        "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_chat_members_chatId_userId" UNIQUE ("chatId", "userId"),
        CONSTRAINT "PK_chat_members_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_members_chatId" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_chat_members_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_chat_members_chatId" ON "chat_members" ("chatId");`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_members_userId" ON "chat_members" ("userId");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_members";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chats";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
  }
}
