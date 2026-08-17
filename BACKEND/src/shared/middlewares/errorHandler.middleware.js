/**
 * =============================================================================
 * InnovateX Revenue OS — Global Error Handler Middleware
 * =============================================================================
 *
 * FILE: src/shared/middlewares/errorHandler.middleware.js
 *
 * PURPOSE
 * ───────
 * Catches ALL errors thrown by routes, services, and middleware.
 * Must be the LAST middleware registered in app.js.
 * Formats errors into a consistent API response shape.
 *
 * ERROR TYPES
 * ───────────
 * AppError (isOperational: true)  → structured client error → log + send
 * Mongoose ValidationError        → map to 422
 * Mongoose CastError              → map to 400 (invalid ObjectId)
 * MongoDB duplicate key (11000)   → map to 409
 * JWT errors                      → map to 401
 * Unknown errors                  → 500 (don't expose internals)
 * =============================================================================
 */

import AppError from '../../utils/AppError.js';

const isDev = process.env.NODE_ENV === 'development';

/**
 * handleMongooseValidationError — converts Mongoose validation errors.
 */
const handleMongooseValidationError = (err) => {
  const errors = Object.values(err.errors).map((e) => ({
    field:   e.path,
    message: e.message,
  }));
  return new AppError('Validation failed', 422, errors);
};

/**
 * handleCastError — invalid MongoDB ObjectId in URL params.
 */
const handleCastError = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);

/**
 * handleDuplicateKeyError — MongoDB unique constraint violation.
 */
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue || {})[0];
  const value = err.keyValue?.[field];
  return new AppError(
    `Duplicate value: ${field} "${value}" already exists`,
    409
  );
};

/**
 * handleJWTError — invalid JWT.
 */
const handleJWTError = () =>
  new AppError('Invalid authentication token. Please log in again.', 401);

/**
 * handleJWTExpiredError — expired JWT.
 */
const handleJWTExpiredError = () =>
  new AppError('Your session has expired. Please log in again.', 401);

/**
 * errorHandler — Express global error handler (4-argument signature required).
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // Set defaults
  let error = { ...err };
  error.message    = err.message;
  error.statusCode = err.statusCode || 500;
  error.status     = err.status || 'error';
  error.isOperational = err.isOperational || false;

  // Transform known error types into AppError
  if (err.name === 'ValidationError')      error = handleMongooseValidationError(err);
  if (err.name === 'CastError')            error = handleCastError(err);
  if (err.code === 11000)                  error = handleDuplicateKeyError(err);
  if (err.name === 'JsonWebTokenError')    error = handleJWTError();
  if (err.name === 'TokenExpiredError')    error = handleJWTExpiredError();

  // Log error details (development: full stack; production: summary)
  if (isDev) {
    console.error('🔴 ERROR:', {
      message:    error.message,
      statusCode: error.statusCode,
      stack:      err.stack,
      // Some SDKs (e.g. Razorpay's Node client) reject with a plain
      // object shaped like { statusCode, error: { code, description } }
      // instead of a real Error -- message/stack above are undefined for
      // those, which is why they used to log as a useless
      // "{ message: undefined, statusCode: 400, stack: undefined }".
      // Dumping the raw original error alongside makes whatever shape it
      // actually has visible, regardless of which library threw it.
      raw: err && err.message === undefined ? err : undefined,
    });
  } else if (!error.isOperational) {
    // Production: log unexpected errors (don't expose to client)
    console.error('🔴 UNEXPECTED ERROR:', err);
  }

  // Send response
  const response = {
    success: false,
    message: error.isOperational ? error.message : 'Something went wrong. Please try again.',
  };

  if (error.details && error.details.length > 0) {
    response.errors = error.details;
  } else if (error.errors && error.errors.length > 0) {
    // Some error sources (e.g. handleMongooseValidationError below) build
    // their AppError with a differently-named field -- keep this as a
    // fallback so neither convention silently drops detail.
    response.errors = error.errors;
  }

  // Stack trace only in development
  if (isDev && err.stack) {
    response.stack = err.stack;
  }

  return res.status(error.statusCode).json(response);
};

/**
 * notFoundHandler — catches unmatched routes (404).
 * Register BEFORE errorHandler, AFTER all routes.
 */
export const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};