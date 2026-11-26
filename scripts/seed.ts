import 'reflect-metadata';
import { initializeDatabase, closeDatabase, AppDataSource } from '../src/config/database';
import { User } from '../src/entities/User.entity';
import { ChatService } from '../src/modules/chat/chat.service';

async function seed() {
  try {
    // eslint-disable-next-line no-console
    console.info('Connecting to database...');
    await initializeDatabase();

    const userRepo = AppDataSource.getRepository(User);
    const chatService = new ChatService();

    // eslint-disable-next-line no-console
    console.info('Seeding test users...');
    const users = [
      { id: 'a0000000-0000-0000-0000-000000000001', name: 'Alice Johnson', email: 'alice@example.com' },
      { id: 'b0000000-0000-0000-0000-000000000002', name: 'Bob Smith', email: 'bob@example.com' },
      { id: 'c0000000-0000-0000-0000-000000000003', name: 'Charlie Brown', email: 'charlie@example.com' },
      { id: 'd0000000-0000-0000-0000-000000000004', name: 'Diana Prince', email: 'diana@example.com' },
    ];

    for (const u of users) {
      const exists = await userRepo.findOneBy({ id: u.id });
      if (!exists) {
        await userRepo.save(u);
        // eslint-disable-next-line no-console
        console.info(`Created user: ${u.name} (${u.id})`);
      }
    }

    // eslint-disable-next-line no-console
    console.info('Seeding direct chat between Alice and Bob...');
    const chat = await chatService.createOrGetDirectChat(users[0].id, users[1].id);
    // eslint-disable-next-line no-console
    console.info(`Direct chat ready: chatId=${chat.chatId} (isNew=${chat.isNew})`);

    // eslint-disable-next-line no-console
    console.info('Seeding complete!');
    await closeDatabase();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
