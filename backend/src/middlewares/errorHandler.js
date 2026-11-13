import { errorResponse } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Centralized Global Error Handler
 */
export function errorHandler(err, req, res, next) {
  logger.error('Unhandled or caught error', {
    name: err.name,
    message: err.message,
    code: err.code,
    path: req.originalUrl,
    method: req.method
  });

  // Mongoose CastError (e.g. invalid ObjectId format)
  if (err.name === 'CastError') {
    return errorResponse(res, {
      code: 'INVALID_ID_FORMAT',
      message: `Invalid identifier format: '${err.value}' for field '${err.path}'`
    }, 400);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return errorResponse(res, {
      code: 'DUPLICATE_KEY_ERROR',
      message: `A record with this ${field} already exists.`
    }, 409);
  }

  // Mongoose schema validation error (has err.errors dictionary)
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map(e => ({ field: e.path, message: e.message }));
    return errorResponse(res, {
      code: 'SCHEMA_VALIDATION_ERROR',
      message: err.message,
      details
    }, 400);
  }

  // Domain AppError (e.g. ValidationError, TransitionError, NotFoundError, etc.)
  if (err instanceof AppError || err.statusCode) {
    return errorResponse(res, {
      code: err.code || 'APPLICATION_ERROR',
      message: err.message,
      details: err.details || null
    }, err.statusCode || 400);
  }

  return errorResponse(res, {
    code: 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred'
  }, 500);
}
