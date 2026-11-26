import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './env';
import { User, Chat, ChatMember } from '../entities';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: config.db.synchronize,
  logging: config.db.logging,
  entities: [User, Chat, ChatMember],
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  subscribers: [],
});

export async function initializeDatabase(): Promise<DataSource> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}
