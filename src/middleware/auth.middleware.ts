import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../common/errors';
import { config } from '../config/env';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// Matches PostgreSQL UUID & Joi GUID format cleanly (including seeded hex fixture UUIDs)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifyHs256Jwt(token: string, secret: string): { sub: string; email?: string } | null {
  if (!secret || secret.length < 32) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return null;
  }

  const parsedHeader: unknown = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  if (!isPlainObject(parsedHeader) || parsedHeader.alg !== 'HS256') {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actualSig = Buffer.from(signatureB64, 'base64url');

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    return null;
  }

  const parsedPayload: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (!isPlainObject(parsedPayload)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsedPayload.exp !== undefined) {
    if (
      typeof parsedPayload.exp !== 'number' ||
      !Number.isFinite(parsedPayload.exp) ||
      nowSeconds >= parsedPayload.exp
    ) {
      return null;
    }
  }

  if (parsedPayload.nbf !== undefined) {
    if (
      typeof parsedPayload.nbf !== 'number' ||
      !Number.isFinite(parsedPayload.nbf) ||
      nowSeconds < parsedPayload.nbf
    ) {
      return null;
    }
  }

  if (typeof parsedPayload.sub !== 'string' || !UUID_REGEX.test(parsedPayload.sub.trim())) {
    return null;
  }

  return {
    sub: parsedPayload.sub.trim(),
    email: typeof parsedPayload.email === 'string' ? parsedPayload.email : undefined,
  };
}

/**
 * Authorization & Identity Middleware
 *
 * In production / strict auth mode (AUTH_REQUIRED=true):
 * - Requires a valid signed HS256 Bearer JWT with valid UUID sub (and unexpired exp if present).
 * - Rejects X-User-Id header spoofing and unverified/raw Bearer tokens.
 *
 * In development / assessment compatibility mode (AUTH_REQUIRED=false):
 * - Permits explicit body-provided IDs, query userId, or optional X-User-Id header.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const devUserIdHeader = req.headers['x-user-id'] as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (!token) {
      if (config.auth.authRequired) {
        next(new UnauthorizedError('Invalid authorization token format'));
        return;
      }
      // In dev mode, ignore blank Bearer header (e.g. unset collection token variable)
      if (devUserIdHeader) {
        req.user = { id: devUserIdHeader };
      }
      next();
      return;
    }

    try {
      if (config.auth.authRequired) {
        const verified = verifyHs256Jwt(token, config.auth.jwtSecret);
        if (!verified) {
          next(new UnauthorizedError('Invalid or expired authentication token'));
          return;
        }
        req.user = { id: verified.sub, email: verified.email };
        next();
        return;
      }

      const parts = token.split('.');
      if (parts.length === 3) {
        const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (isPlainObject(payload) && typeof payload.sub === 'string' && payload.sub.trim()) {
          req.user = {
            id: payload.sub.trim(),
            email: typeof payload.email === 'string' ? payload.email : undefined,
          };
          next();
          return;
        }
      }

      req.user = { id: token };
      next();
      return;
    } catch {
      next(new UnauthorizedError('Invalid or expired authentication token'));
      return;
    }
  }

  if (config.auth.authRequired) {
    next(new UnauthorizedError('Missing required Authorization header'));
    return;
  }

  if (devUserIdHeader) {
    req.user = { id: devUserIdHeader };
    next();
    return;
  }

  next();
}

/**
 * Ensures an authenticated user cannot spoof or act on behalf of a different actor ID
 * when AUTH_REQUIRED=true.
 */
export function enforceAuthenticatedActor(req: Request, claimedActorId: string): void {
  if (config.auth.authRequired && req.user && req.user.id !== claimedActorId) {
    throw new ForbiddenError('Authenticated identity does not match requested actor ID');
  }
}

/**
 * Restricts provisioning user accounts via POST /user to development/demo mode only.
 */
export function restrictUserCreationToDev(_req: Request, _res: Response, next: NextFunction): void {
  if (config.env === 'production' || config.auth.authRequired) {
    next(
      new ForbiddenError(
        'User creation endpoint is restricted to development mode (AUTH_REQUIRED=false)',
      ),
    );
    return;
  }
  next();
}
