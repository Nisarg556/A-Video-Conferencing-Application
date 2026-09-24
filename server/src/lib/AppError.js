// An expected, client-facing error. Anything thrown that is NOT an AppError
// is treated as a bug and returned as a generic 500.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'You are not allowed to do that', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(code, message) {
    return new AppError(409, code, message);
  }

  static gone(code, message) {
    return new AppError(410, code, message);
  }

  static tooManyRequests(message = 'Too many requests, please try again later') {
    return new AppError(429, 'RATE_LIMITED', message);
  }
}
