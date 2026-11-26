import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../src/middleware/validation.middleware';
import { errorHandler } from '../../src/middleware/error.middleware';
import { authenticate, enforceAuthenticatedActor } from '../../src/middleware/auth.middleware';
import { config } from '../../src/config/env';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../src/common/errors';

function signTestJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

describe('Middlewares - Unit Tests', () => {
  describe('Validation Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.MockedFunction<NextFunction>;

    const schema = Joi.object({
      name: Joi.string().required(),
      age: Joi.number().optional(),
    });

    beforeEach(() => {
      mockReq = {};
      mockRes = {};
      mockNext = jest.fn();
    });

    it('should pass valid body payload', () => {
      mockReq.body = { name: 'John', age: 30 };
      validateBody(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.body).toEqual({ name: 'John', age: 30 });
    });

    it('should reject invalid body and pass BadRequestError to next', () => {
      mockReq.body = { age: 'not-a-number' };
      validateBody(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
    });

    it('should validate params and pass BadRequestError on failure', () => {
      const paramSchema = Joi.object({ id: Joi.string().uuid().required() });
      mockReq.params = { id: 'invalid-uuid' };

      validateParams(paramSchema)(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
    });

    it('should validate query and pass BadRequestError on failure', () => {
      const querySchema = Joi.object({ limit: Joi.number().max(50).required() });
      mockReq.query = { limit: '100' };

      validateQuery(querySchema)(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
    });
  });

  describe('Error Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.MockedFunction<NextFunction>;
    let statusFn: jest.Mock;
    let jsonFn: jest.Mock;

    beforeEach(() => {
      mockReq = {};
      jsonFn = jest.fn();
      statusFn = jest.fn().mockReturnValue({ json: jsonFn });
      mockRes = {
        headersSent: false,
        status: statusFn,
        json: jsonFn,
      };
      mockNext = jest.fn();
    });

    it('should format AppError into standard JSON error response', () => {
      const err = new ForbiddenError('You do not have access');
      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith({
        success: false,
        message: 'You do not have access',
        errorCode: 'FORBIDDEN',
      });
    });

    it('should handle PostgreSQL unique constraint violation (code 23505) as 409 Conflict', () => {
      const pgErr = new Error('duplicate key value violates unique constraint');
      (pgErr as unknown as { code: string }).code = '23505';

      errorHandler(pgErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(409);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'CONFLICT',
        }),
      );
    });

    it('should handle PostgreSQL foreign key violation (code 23503) as 400 Bad Request', () => {
      const pgErr = new Error('violates foreign key constraint');
      (pgErr as unknown as { code: string }).code = '23503';

      errorHandler(pgErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'BAD_REQUEST',
        }),
      );
    });

    it('should handle PostgreSQL invalid UUID syntax (code 22P02) as 400 Bad Request', () => {
      const pgErr = new Error('invalid input syntax for type uuid');
      (pgErr as unknown as { code: string }).code = '22P02';

      errorHandler(pgErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'BAD_REQUEST',
        }),
      );
    });

    it('should handle Firebase unavailable error code 14 as 503 Service Unavailable', () => {
      const fbErr = new Error('Firestore connection timeout');
      (fbErr as unknown as { code: number }).code = 14;

      errorHandler(fbErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(503);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'SERVICE_UNAVAILABLE',
        }),
      );
    });

    it('should handle body parser JSON syntax error as 400 Bad Request', () => {
      const syntaxErr = new SyntaxError('Unexpected token in JSON at position 4');
      (syntaxErr as unknown as { status: number }).status = 400;

      errorHandler(syntaxErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'BAD_REQUEST',
        }),
      );
    });

    it('should fallback to 500 Internal Server Error for unhandled exceptions without leaking credentials', () => {
      const unhandledErr = new Error('Unexpected core dump');
      errorHandler(unhandledErr, mockReq as Request, mockRes as Response, mockNext);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: 'INTERNAL_SERVER_ERROR',
        }),
      );
    });
  });

  describe('Auth & Actor Guard Middleware (Strict AUTH_REQUIRED=true)', () => {
    const origAuthRequired = config.auth.authRequired;
    const origJwtSecret = config.auth.jwtSecret;
    const testSecret = 'f1e2d3c4b5a69788796a5b4c3d2e1f009988776655443322';

    afterEach(() => {
      config.auth.authRequired = origAuthRequired;
      config.auth.jwtSecret = origJwtSecret;
    });

    it('should verify HS256 JWT signature and block tampered/unauthenticated requests when AUTH_REQUIRED=true', () => {
      config.auth.authRequired = true;
      config.auth.jwtSecret = testSecret;
      const validToken = signTestJwt(
        { sub: 'a0000000-0000-0000-0000-000000000001', exp: Math.floor(Date.now() / 1000) + 300 },
        testSecret,
      );

      const okReq = { headers: { authorization: `Bearer ${validToken}` } } as unknown as Request;
      const okNext = jest.fn() as jest.MockedFunction<NextFunction>;
      authenticate(okReq, {} as Response, okNext);
      expect(okReq.user?.id).toBe('a0000000-0000-0000-0000-000000000001');
      expect(okNext).toHaveBeenCalledWith();

      const tamperedReq = {
        headers: { authorization: `Bearer ${validToken}tamper` },
      } as unknown as Request;
      const tamperedNext = jest.fn() as jest.MockedFunction<NextFunction>;
      authenticate(tamperedReq, {} as Response, tamperedNext);
      expect(tamperedNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));

      const spoofHeaderReq = {
        headers: { 'x-user-id': 'a0000000-0000-0000-0000-000000000001' },
      } as unknown as Request;
      const spoofNext = jest.fn() as jest.MockedFunction<NextFunction>;
      authenticate(spoofHeaderReq, {} as Response, spoofNext);
      expect(spoofNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should prevent body actor spoofing when authenticated user does not match claimed actor ID', () => {
      config.auth.authRequired = true;
      const req = {
        user: { id: 'a0000000-0000-0000-0000-000000000001' },
      } as unknown as Request;

      expect(() => enforceAuthenticatedActor(req, 'b0000000-0000-0000-0000-000000000002')).toThrow(
        ForbiddenError,
      );
    });
  });
});
