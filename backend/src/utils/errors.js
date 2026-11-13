/**
 * Custom domain error classes
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'Concurrent request in progress for this Idempotency-Key or conflicting payload', details = null) {
    super(message, 409, 'IDEMPOTENCY_CONFLICT', details);
  }
}

export class TransitionError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'INVALID_STATE_TRANSITION', details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message, isRetryable = true, details = null) {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR', details);
    this.isRetryable = isRetryable;
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Unauthorized action', details = null) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

