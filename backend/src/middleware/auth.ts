import type { Request, Response, NextFunction } from 'express';
import { pool } from '../config/db';

// Attached to req by this middleware — routes read tenantId/userId from HERE,
// never from req.body or req.params.
export interface AuthContext {
  tenantId: string;
  userId: string;
  role: 'admin' | 'evaluator' | 'viewer';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// For this assessment: the "token" is just the user's UUID, sent as a Bearer token.
// A real system would verify a signed JWT or session; the lookup-not-trust
// principle below is what actually matters and stays the same either way.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Missing or malformed Authorization header', requestId: req.id },
    });
  }

  const userId = header.slice('Bearer '.length).trim();

  const { rows } = await pool.query(
    `SELECT id, tenant_id, role FROM users WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials', requestId: req.id },
    });
  }

  // This is THE line that matters: tenantId comes from the DB row matched to
  // the authenticated user — never from anything the client typed into the request.
  req.auth = { tenantId: rows[0].tenant_id, userId: rows[0].id, role: rows[0].role };
  next();
}