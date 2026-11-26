import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config, validateEnvironment } from '../../src/config/env';
import {
  authenticate,
  enforceAuthenticatedActor,
  restrictUserCreationToDev,
} from '../../src/middleware/auth.middleware';
import { ForbiddenError, UnauthorizedError } from '../../src/common/errors';

function signJwt(
  headerObj: Record<string, unknown>,
  payloadObj: Record<string, unknown>,
  secret: string,
): string {
  const header = Buffer.from(JSON.stringify(headerObj)).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('Security & Auth Hardening - Unit Tests', () => {
  const strongSecret = '9d4f7b2c8e1a6f305b8c2d9e4a1f7c3b8e2d9a4c1f7b3e6a';

  describe('Fail-Closed Production & Development Environment Validation', () => {
    const baseProdEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'strong_db_password',
      DB_NAME: 'chat_system',
      AUTH_REQUIRED: 'true',
      CORS_ORIGIN: 'https://chat.example.com',
      JWT_SECRET: strongSecret,
    };

    it('should reject production startup when AUTH_REQUIRED is missing or false', () => {
      const missingAuth = { ...baseProdEnv };
      delete missingAuth.AUTH_REQUIRED;
      expect(() => validateEnvironment(missingAuth)).toThrow(/AUTH_REQUIRED/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_REQUIRED: 'false',
        }),
      ).toThrow(/AUTH_REQUIRED/);
    });

    it('should reject production startup when CORS_ORIGIN is missing or wildcard (*)', () => {
      const missingCors = { ...baseProdEnv };
      delete missingCors.CORS_ORIGIN;
      expect(() => validateEnvironment(missingCors)).toThrow(/CORS_ORIGIN/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          CORS_ORIGIN: '*',
        }),
      ).toThrow(/CORS_ORIGIN/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          CORS_ORIGIN: 'https://chat.example.com, *',
        }),
      ).toThrow(/CORS_ORIGIN/);
    });

    it('should reject missing, short, default, or placeholder JWT_SECRET in production', () => {
      const missingSecret = { ...baseProdEnv };
      delete missingSecret.JWT_SECRET;
      expect(() => validateEnvironment(missingSecret)).toThrow(/JWT_SECRET/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          JWT_SECRET: 'supersecretjwtkeyforchatbackend1234567890',
        }),
      ).toThrow(/JWT_SECRET/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          JWT_SECRET: 'replace-with-secure-random-32-plus-char-secret',
        }),
      ).toThrow(/JWT_SECRET/);

      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          JWT_SECRET: 'short_secret',
        }),
      ).toThrow(/32 characters/);
    });

    it('should also require explicit >=32 char non-default JWT_SECRET in dev when AUTH_REQUIRED=true', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          AUTH_REQUIRED: 'true',
          DB_HOST: 'localhost',
          DB_USERNAME: 'postgres',
          DB_NAME: 'chat_system',
        }),
      ).toThrow(/JWT_SECRET/);

      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          AUTH_REQUIRED: 'true',
          DB_HOST: 'localhost',
          DB_USERNAME: 'postgres',
          DB_NAME: 'chat_system',
          JWT_SECRET: 'replace-with-secure-random-32-plus-char-secret',
        }),
      ).toThrow(/JWT_SECRET/);
    });

    it('should keep development usable with AUTH_REQUIRED=false without hardcoded JWT secrets', () => {
      const devConfig = validateEnvironment({
        NODE_ENV: 'development',
        DB_HOST: 'localhost',
        DB_USERNAME: 'postgres',
        DB_NAME: 'chat_system',
      });
      expect(devConfig.env).toBe('development');
      expect(devConfig.auth.authRequired).toBe(false);
      expect(devConfig.auth.jwtSecret).toBe('');
      expect(devConfig.security.corsOrigin).toBe('*');
    });

    it('should accept properly hardened production configuration', () => {
      const prodConfig = validateEnvironment({
        ...baseProdEnv,
        CORS_ORIGIN: 'https://chat.example.com, https://admin.example.com',
      });
      expect(prodConfig.env).toBe('production');
      expect(prodConfig.auth.authRequired).toBe(true);
      expect(prodConfig.auth.jwtSecret).toBe(strongSecret);
      expect(prodConfig.security.corsOrigin).toBe(
        'https://chat.example.com, https://admin.example.com',
      );
    });
  });

  describe('Strict JWT Verification & Route Guards', () => {
    const origAuthRequired = config.auth.authRequired;
    const origJwtSecret = config.auth.jwtSecret;
    const origEnv = config.env;

    afterEach(() => {
      config.auth.authRequired = origAuthRequired;
      config.auth.jwtSecret = origJwtSecret;
      config.env = origEnv;
    });

    it('should reject missing, expired, future-nbf, unsigned (alg=none), wrong-signature, and non-UUID/empty sub JWTs', () => {
      config.auth.authRequired = true;
      config.auth.jwtSecret = strongSecret;
      const nowSec = Math.floor(Date.now() / 1000);

      const expiredToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 'a0000000-0000-0000-0000-000000000001', exp: nowSec - 10 },
        strongSecret,
      );
      const futureNbfToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 'a0000000-0000-0000-0000-000000000001', nbf: nowSec + 120, exp: nowSec + 300 },
        strongSecret,
      );
      const algNoneToken = signJwt(
        { alg: 'none', typ: 'JWT' },
        { sub: 'a0000000-0000-0000-0000-000000000001', exp: nowSec + 300 },
        strongSecret,
      );
      const wrongSecretToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 'a0000000-0000-0000-0000-000000000001', exp: nowSec + 300 },
        'wrong-secret-key-for-signing-attempt',
      );
      const emptySubToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: '', exp: nowSec + 300 },
        strongSecret,
      );
      const nonUuidSubToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 'not-a-valid-uuid-subject', exp: nowSec + 300 },
        strongSecret,
      );
      const numericSubToken = signJwt(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 12345, exp: nowSec + 300 },
        strongSecret,
      );

      for (const badToken of [
        expiredToken,
        futureNbfToken,
        algNoneToken,
        wrongSecretToken,
        emptySubToken,
        nonUuidSubToken,
        numericSubToken,
      ]) {
        const req = { headers: { authorization: `Bearer ${badToken}` } } as unknown as Request;
        const next = jest.fn() as jest.MockedFunction<NextFunction>;
        authenticate(req, {} as Response, next);
        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      }
    });

    it('should safely ignore empty Authorization Bearer header in dev mode (AUTH_REQUIRED=false) while rejecting in strict mode', () => {
      config.auth.authRequired = false;
      const devReq = {
        headers: {
          authorization: 'Bearer ',
          'x-user-id': 'a0000000-0000-0000-0000-000000000001',
        },
      } as unknown as Request;
      const devNext = jest.fn() as jest.MockedFunction<NextFunction>;
      authenticate(devReq, {} as Response, devNext);
      expect(devNext).toHaveBeenCalledWith();
      expect(devReq.user?.id).toBe('a0000000-0000-0000-0000-000000000001');

      config.auth.authRequired = true;
      config.auth.jwtSecret = strongSecret;
      const strictReq = { headers: { authorization: 'Bearer ' } } as unknown as Request;
      const strictNext = jest.fn() as jest.MockedFunction<NextFunction>;
      authenticate(strictReq, {} as Response, strictNext);
      expect(strictNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should restrict POST /user provisioning when in production or AUTH_REQUIRED=true', () => {
      config.auth.authRequired = true;
      const next1 = jest.fn() as jest.MockedFunction<NextFunction>;
      restrictUserCreationToDev({} as Request, {} as Response, next1);
      expect(next1).toHaveBeenCalledWith(expect.any(ForbiddenError));

      config.auth.authRequired = false;
      config.env = 'production';
      const next2 = jest.fn() as jest.MockedFunction<NextFunction>;
      restrictUserCreationToDev({} as Request, {} as Response, next2);
      expect(next2).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should block mismatched actor claims when AUTH_REQUIRED=true', () => {
      config.auth.authRequired = true;
      const req = {
        user: { id: 'a0000000-0000-0000-0000-000000000001' },
      } as unknown as Request;

      expect(() => enforceAuthenticatedActor(req, 'b0000000-0000-0000-0000-000000000002')).toThrow(
        ForbiddenError,
      );
      expect(() =>
        enforceAuthenticatedActor(req, 'a0000000-0000-0000-0000-000000000001'),
      ).not.toThrow();
    });
  });
});
