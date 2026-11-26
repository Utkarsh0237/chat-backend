export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly errorCode: string;
  public readonly isOperational: boolean = true;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  public readonly statusCode = 400;
  public readonly errorCode = 'BAD_REQUEST';

  constructor(message: string = 'Bad request') {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly errorCode = 'UNAUTHORIZED';

  constructor(message: string = 'Unauthorized') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly errorCode = 'FORBIDDEN';

  constructor(message: string = 'Forbidden') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly errorCode = 'NOT_FOUND';

  constructor(message: string = 'Resource not found') {
    super(message);
  }
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly errorCode = 'CONFLICT';

  constructor(message: string = 'Conflict') {
    super(message);
  }
}

export class InternalServerError extends AppError {
  public readonly statusCode = 500;
  public readonly errorCode = 'INTERNAL_SERVER_ERROR';

  constructor(message: string = 'Internal server error') {
    super(message);
  }
}

export class ServiceUnavailableError extends AppError {
  public readonly statusCode = 503;
  public readonly errorCode = 'SERVICE_UNAVAILABLE';

  constructor(message: string = 'Service temporarily unavailable') {
    super(message);
  }
}
