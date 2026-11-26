import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorHandler } from './middleware/error.middleware';
import { notFoundHandler } from './middleware/not-found.middleware';
import { authenticate } from './middleware/auth.middleware';
import { config } from './config/env';

export function createApp(): Application {
  const app = express();

  // Security HTTP headers
  app.use(helmet());

  // CORS configuration (production validates non-wildcard allowlist in env.ts)
  const trimmedCors = config.security.corsOrigin.trim();
  const corsOrigin =
    trimmedCors === '*' && config.env !== 'production'
      ? '*'
      : trimmedCors
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0 && origin !== '*');

  app.use(
    cors({
      origin: corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id'],
    }),
  );

  // Rate limiting to protect against abuse/DDoS
  const limiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later',
      errorCode: 'RATE_LIMIT_EXCEEDED',
    },
  });
  app.use(limiter);

  // Parse JSON payloads with strict limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Global identity / auth middleware
  app.use(authenticate);

  // Mount API routes
  if (config.apiPrefix && config.apiPrefix !== '') {
    app.use(config.apiPrefix, routes);
  }
  // Mount directly for assignment compatibility (e.g. /chat/create)
  app.use('/', routes);

  // Unmatched route handler (404)
  app.use(notFoundHandler);

  // Centralized Error handler
  app.use(errorHandler);

  return app;
}

export default createApp();
