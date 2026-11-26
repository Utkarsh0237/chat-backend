import { Request, Response, NextFunction } from 'express';
import { AppError } from '../common/errors';
import { config } from '../config/env';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // If headers have already been sent, delegate to Express default handler
  if (res.headersSent) {
    return _next(err);
  }

  // 1. Handled operational AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode,
    });
    return;
  }

  // 2. Body Parser JSON Syntax Error
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    res.status(400).json({
      success: false,
      message: 'Invalid JSON payload in request body',
      errorCode: 'BAD_REQUEST',
    });
    return;
  }

  // 3. PostgreSQL / TypeORM error codes
  const pgErr = err as { code?: string; detail?: string };
  if (pgErr.code === '23505') {
    // Unique violation
    res.status(409).json({
      success: false,
      message: 'Resource already exists (unique constraint violation)',
      errorCode: 'CONFLICT',
    });
    return;
  }
  if (pgErr.code === '23503') {
    // Foreign key violation
    res.status(400).json({
      success: false,
      message: 'Referenced entity does not exist (foreign key violation)',
      errorCode: 'BAD_REQUEST',
    });
    return;
  }
  if (pgErr.code === '22P02') {
    // Invalid text representation (e.g. malformed UUID from header)
    res.status(400).json({
      success: false,
      message: 'Invalid identifier format (UUID expected)',
      errorCode: 'BAD_REQUEST',
    });
    return;
  }

  // 4. Firebase / Firestore errors
  const firebaseErr = err as { code?: number | string; details?: string };
  if (
    firebaseErr.code === 14 || // UNAVAILABLE
    firebaseErr.code === 4 || // DEADLINE_EXCEEDED
    firebaseErr.code === 'unavailable'
  ) {
    res.status(503).json({
      success: false,
      message: 'Chat messaging service is temporarily unavailable',
      errorCode: 'SERVICE_UNAVAILABLE',
    });
    return;
  }

  // 5. Unhandled / Unexpected Errors
  const isDev = config.env === 'development';
  // eslint-disable-next-line no-console
  console.error('[UnhandledError]', err);

  res.status(500).json({
    success: false,
    message: isDev ? err.message : 'An unexpected internal error occurred',
    errorCode: 'INTERNAL_SERVER_ERROR',
  });
}
