import { AppError } from '../lib/AppError.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
}

// Every error leaves the API in the same shape:
//   { "error": { "code": "SOME_CODE", "message": "...", "details": [...]? } }
// Unexpected (500) errors also carry the request id, to find the full log line.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else {
    // Unexpected: log the full error server-side, never leak it to clients.
    req.log?.error({ err }, 'unhandled error');
    if (!env.isProduction) message = err.message || message;
  }

  res.status(status).json({
    error: { code, message, ...(details && { details }), ...(status >= 500 && req.id && { requestId: req.id }) },
  });
}
