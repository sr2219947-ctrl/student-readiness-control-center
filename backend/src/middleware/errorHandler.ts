import type { Request, Response, NextFunction } from 'express';

// A deliberate, known error type our own code throws — distinct from
// unexpected crashes (DB down, bug, etc), which get handled separately below.
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

// Express recognizes this as an error handler specifically because it takes 4 args.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId: req.id, ...(err.fields && { fields: err.fields }) },
    });
  }

  // express.json() throws a SyntaxError with a `status` property on malformed JSON bodies.
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId: req.id },
    });
  }

  // Anything else is unexpected — log it fully server-side for debugging, but
  // NEVER include the stack trace, DB error details, or internals in the response.
  console.error(`[${req.id}] Unhandled error:`, err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: req.id },
  });
}