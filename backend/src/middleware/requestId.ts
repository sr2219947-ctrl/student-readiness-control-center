import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// Runs BEFORE every other middleware/route — assigns a unique ID to each
// incoming request so it can be traced through logs and echoed in error responses.
export function requestId(req: Request, _res: Response, next: NextFunction) {
  req.id = randomUUID();
  next();
}