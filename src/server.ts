import 'reflect-metadata';
import { createApp } from './app';
import { initializeDatabase, closeDatabase } from './config/database';
import { initializeFirebase } from './config/firebase';
import { config } from './config/env';

async function bootstrap(): Promise<void> {
  try {
    // 1. Initialize PostgreSQL Connection
    await initializeDatabase();
    // eslint-disable-next-line no-console
    console.info('Connected to PostgreSQL successfully.');

    // 2. Initialize Firebase / Firestore
    initializeFirebase();
    // eslint-disable-next-line no-console
    console.info('Initialized Firebase Admin SDK successfully.');

    // 3. Start Express HTTP Server
    const app = createApp();
    const server = app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.info(`Chat Backend server listening on port ${config.port} (${config.env})`);
    });

    // Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      // eslint-disable-next-line no-console
      console.info(`Received ${signal}. Gracefully shutting down...`);

      server.close(async () => {
        // eslint-disable-next-line no-console
        console.info('HTTP server closed.');

        try {
          await closeDatabase();
          // eslint-disable-next-line no-console
          console.info('PostgreSQL connection closed.');
          process.exit(0);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Error during database teardown:', err);
          process.exit(1);
        }
      });

      // Force terminate after 10 seconds timeout
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error('Forced shutdown timeout exceeded. Exiting.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      // eslint-disable-next-line no-console
      console.error('Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
      // eslint-disable-next-line no-console
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}

bootstrap();
