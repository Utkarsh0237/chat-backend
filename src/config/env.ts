import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const WEAK_DEFAULT_JWT_SECRETS = new Set([
  'supersecretjwtkeyforchatbackend1234567890',
  'replace-with-secure-random-32-plus-char-secret',
  'changeme',
  'secret',
  'default',
]);

const jwtSecretValidator = Joi.string()
  .min(32)
  .required()
  .custom((value: string, helpers) => {
    if (WEAK_DEFAULT_JWT_SECRETS.has(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .messages({
    'any.required': 'JWT_SECRET must be explicitly set when AUTH_REQUIRED=true or in production',
    'string.empty': 'JWT_SECRET cannot be empty when AUTH_REQUIRED=true or in production',
    'string.min': 'JWT_SECRET must be at least 32 characters',
    'any.invalid': 'JWT_SECRET cannot use a weak or default placeholder value',
  });

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().allow('').default(''),

  // PostgreSQL
  DB_HOST: Joi.string().required().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required().default('postgres'),
  DB_PASSWORD: Joi.string().allow('').default('postgres'),
  DB_NAME: Joi.string().required().default('chat_system'),
  DB_LOGGING: Joi.boolean().default(false),
  DB_SYNCHRONIZE: Joi.boolean().default(false),

  // Firebase
  FIREBASE_PROJECT_ID: Joi.string().default('demo-chat-system'),
  FIREBASE_SERVICE_ACCOUNT_KEY_PATH: Joi.string().allow('').optional(),
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: Joi.string().allow('').optional(),
  FIRESTORE_EMULATOR_HOST: Joi.string().allow('').optional(),

  // Security — production fails closed unless explicit non-wildcard CORS_ORIGIN is configured
  CORS_ORIGIN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .required()
      .custom((value: string, helpers) => {
        const origins = value
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);
        if (origins.length === 0 || origins.includes('*')) {
          return helpers.error('any.invalid');
        }
        return value;
      })
      .messages({
        'any.required': 'CORS_ORIGIN must be explicitly configured in production',
        'string.empty': 'CORS_ORIGIN cannot be empty in production',
        'any.invalid': 'Wildcard CORS_ORIGIN (*) is not permitted in production',
      }),
    otherwise: Joi.string().default('*'),
  }),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 mins
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(1000),

  // Auth — production fails closed unless AUTH_REQUIRED=true is explicitly set
  AUTH_REQUIRED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required().messages({
      'any.required': 'AUTH_REQUIRED must be explicitly set to true in production',
      'any.only': 'AUTH_REQUIRED cannot be false in production; authentication must fail closed',
    }),
    otherwise: Joi.boolean().default(false),
  }),

  // Require an explicit, non-default >=32 char secret in production or whenever AUTH_REQUIRED=true
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: jwtSecretValidator,
    otherwise: Joi.when('AUTH_REQUIRED', {
      is: true,
      then: jwtSecretValidator,
      otherwise: Joi.string().allow('').default(''),
    }),
  }),
}).unknown(true);

export function validateEnvironment(rawEnv: NodeJS.ProcessEnv) {
  const { error, value: envVars } = envSchema.validate(rawEnv);

  if (error) {
    throw new Error(`Environment validation error: ${error.message}`);
  }

  return {
    env: envVars.NODE_ENV as 'development' | 'production',
    port: Number(envVars.PORT),
    apiPrefix: envVars.API_PREFIX as string,

    db: {
      host: envVars.DB_HOST as string,
      port: Number(envVars.DB_PORT),
      username: envVars.DB_USERNAME as string,
      password: envVars.DB_PASSWORD as string,
      database: envVars.DB_NAME as string,
      logging: Boolean(envVars.DB_LOGGING),
      synchronize: Boolean(envVars.DB_SYNCHRONIZE),
    },

    firebase: {
      projectId: envVars.FIREBASE_PROJECT_ID as string,
      serviceAccountKeyPath: envVars.FIREBASE_SERVICE_ACCOUNT_KEY_PATH as string | undefined,
      serviceAccountKeyBase64: envVars.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 as string | undefined,
      emulatorHost: envVars.FIRESTORE_EMULATOR_HOST as string | undefined,
    },

    security: {
      corsOrigin: envVars.CORS_ORIGIN as string,
      rateLimitWindowMs: Number(envVars.RATE_LIMIT_WINDOW_MS),
      rateLimitMaxRequests: Number(envVars.RATE_LIMIT_MAX_REQUESTS),
    },

    auth: {
      jwtSecret: envVars.JWT_SECRET as string,
      authRequired: Boolean(envVars.AUTH_REQUIRED),
    },
  };
}

export const config = validateEnvironment(process.env);
