import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { BadRequestError } from '../common/errors';

export function validateBody(schema: Joi.ObjectSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      next(new BadRequestError(`Validation error: ${details}`));
      return;
    }

    req.body = value;
    next();
  };
}

export function validateParams(schema: Joi.ObjectSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      next(new BadRequestError(`Parameter validation error: ${details}`));
      return;
    }

    req.params = value;
    next();
  };
}

export function validateQuery(schema: Joi.ObjectSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      next(new BadRequestError(`Query validation error: ${details}`));
      return;
    }

    req.query = value;
    next();
  };
}
