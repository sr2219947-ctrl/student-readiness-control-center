import { Router } from 'express';
import { getLatestAttemptsByCompetency, updateStudent } from '../services/studentService';
import { calculateReadiness } from '../domain/readiness';
import { pool } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { submitAttempt } from '../services/attemptService';

export const studentsRouter = Router();

studentsRouter.get('/students/:id', async (req, res, next) => {
  try {
    // req.auth is guaranteed to exist here — requireAuth ran before this handler
    // and would have already returned 401 if it hadn't succeeded.
    const { tenantId } = req.auth!;
    const studentId = req.params.id;

    const studentRow = await pool.query(
      `SELECT id, name, email, version FROM students WHERE tenant_id = $1 AND id = $2`,
      [tenantId, studentId]
    );

    if (studentRow.rows.length === 0) {
      // Same 404 whether the student doesn't exist at all, or exists in a
      // different tenant — no existence leak, per the API invariants.
      throw new AppError(404, 'NOT_FOUND', 'Student not found');
    }

    const latestAttempts = await getLatestAttemptsByCompetency(tenantId, studentId);
    const readiness = calculateReadiness(latestAttempts);

    res.json({
      id: studentRow.rows[0].id,
      name: studentRow.rows[0].name,
      email: studentRow.rows[0].email,
      version: studentRow.rows[0].version,
      competencies: latestAttempts,
      readiness,
    });
  } catch (err) {
    next(err); // hands off to errorHandler — AppError, or anything unexpected
  }
});

const VALID_COMPETENCY_KEYS = ['frontend', 'backend', 'databases', 'problem_solving'] as const;

studentsRouter.post('/students/:id/attempts', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const studentId = req.params.id;

    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
    }

    const { competencyKey, score } = req.body ?? {};

    const fieldErrors: Record<string, string> = {};
    if (!VALID_COMPETENCY_KEYS.includes(competencyKey)) {
      fieldErrors.competencyKey = `Must be one of: ${VALID_COMPETENCY_KEYS.join(', ')}`;
    }
    if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 100) {
      fieldErrors.score = 'Must be a number between 0 and 100';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid attempt payload', fieldErrors);
    }

    // Confirm the student exists in this tenant BEFORE attempting the write —
    // same no-leak reasoning as the GET route: 404 here, not a confusing 500
    // from a foreign-key violation deep inside submitAttempt.
    const studentCheck = await pool.query(
      `SELECT id FROM students WHERE tenant_id = $1 AND id = $2`,
      [tenantId, studentId]
    );
    if (studentCheck.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Student not found');
    }

    const result = await submitAttempt({
      tenantId,
      studentId,
      competencyKey,
      score,
      evaluatorId: userId,
      idempotencyKey,
    });

    switch (result.outcome) {
      case 'created':
        return res.status(201).json({ attemptId: result.attemptId, readiness: result.readiness });
      case 'replayed':
        return res.status(result.status).json(result.body);
      case 'idempotency_conflict':
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
      case 'competency_not_found':
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown competency key');
    }
  } catch (err) {
    next(err);
  }
});

studentsRouter.patch('/students/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const studentId = req.params.id;

    const { name, email, version } = req.body ?? {};

    const fieldErrors: Record<string, string> = {};
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      fieldErrors.version = 'Must be an integer — the version you last read for this student';
    }
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      fieldErrors.name = 'Must be a non-empty string if provided';
    }
    if (email !== undefined && (typeof email !== 'string' || !email.includes('@'))) {
      fieldErrors.email = 'Must be a valid email string if provided';
    }
    if (name === undefined && email === undefined) {
      fieldErrors._body = 'At least one of name or email must be provided';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid update payload', fieldErrors);
    }

    const result = await updateStudent(tenantId, studentId, version, { name, email });

    switch (result.outcome) {
      case 'updated':
        return res.json({ id: studentId, version: result.newVersion });
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'Student not found');
      case 'version_conflict':
        // 409 WITH the current version — lets the client re-fetch and retry,
        // per "conflict containing safe current-version information".
        throw new AppError(409, 'VERSION_CONFLICT', 'Student was updated by someone else', {
          currentVersion: String(result.currentVersion),
        });
    }
  } catch (err) {
    next(err);
  }
});