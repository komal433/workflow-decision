/**
 * Standard API response helper
 */
export function successResponse(res, data, statusCode = 200, message = 'Success') {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
}

export function errorResponse(res, error, statusCode = 500) {
  const code = error.code || 'INTERNAL_ERROR';
  const message = error.message || 'An unexpected error occurred';
  const details = error.details || null;

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details
    }
  });
}

