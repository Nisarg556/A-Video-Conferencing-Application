import { AppError } from '../lib/AppError.js';

const PARTS = ['params', 'query', 'body'];

/**
 * validate({ params?, query?, body? }) — each value is a Zod schema.
 * Parsed (trimmed/coerced) values land on req.validated.<part>.
 * We don't overwrite req.query because it is a read-only getter in Express 5.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const details = [];
    req.validated = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;

      // Express 5 leaves req.body undefined when no JSON body was sent.
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({
            location: part,
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) return next(AppError.validation(details));
    next();
  };
}
