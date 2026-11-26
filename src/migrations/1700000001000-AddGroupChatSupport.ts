import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupChatSupport1700000001000 implements MigrationInterface {
  name = 'AddGroupChatSupport1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" ADD COLUMN "name" character varying(100);`);
    await queryRunner.query(`ALTER TABLE "chats" ADD COLUMN "createdBy" UUID;`);
    await queryRunner.query(
      `ALTER TABLE "chats" ADD CONSTRAINT "FK_chats_createdBy" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_chats_type" ON "chats" ("type");`);

    await queryRunner.query(
      `ALTER TABLE "chat_members" ADD COLUMN "role" character varying(20) NOT NULL DEFAULT 'MEMBER';`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_members_chatId_role" ON "chat_members" ("chatId", "role");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_members_chatId_role";`);
    await queryRunner.query(`ALTER TABLE "chat_members" DROP COLUMN IF EXISTS "role";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chats_type";`);
    await queryRunner.query(`ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "FK_chats_createdBy";`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN IF EXISTS "createdBy";`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN IF EXISTS "name";`);
  }
}
