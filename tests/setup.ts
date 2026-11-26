import dotenv from 'dotenv';
import path from 'path';

// Load .env directly (override Jest's automatic NODE_ENV='test' so only dev env is used)
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}
