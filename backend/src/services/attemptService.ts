import { pool } from '../config/db';
import { computeFingerprint, checkIdempotency } from '../domain/idempotency';
import { calculateReadiness } from '../domain/readiness';
import { getLatestAttemptsByCompetency } from './studentService';

interface SubmitAttemptInput {
  tenantId: string;
  studentId: string;
  competencyKey: 'frontend' | 'backend' | 'databases' | 'problem_solving';
  score: number;
  evaluatorId: string;
  idempotencyKey: string;
}

export type SubmitAttemptResult =
  | { outcome: 'created'; attemptId: string; readiness: { overallScore: number | null; status: string } }
  | { outcome: 'replayed'; status: number; body: unknown }
  | { outcome: 'idempotency_conflict' }
  | { outcome: 'competency_not_found' };

export async function submitAttempt(input: SubmitAttemptInput): Promise<SubmitAttemptResult> {
  const fingerprint = computeFingerprint({
    studentId: input.studentId,
    competencyKey: input.competencyKey,
    score: input.score,
    evaluatorId: input.evaluatorId,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the idempotency row (if any) for the duration of this transaction —
    // this is what stops two parallel requests with the same key from both
    // deciding "no_record" and both proceeding to insert.
    const existing = await client.query(
      `SELECT request_fingerprint, response_status, response_body
       FROM idempotency_records
       WHERE tenant_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.tenantId, input.idempotencyKey]
    );

    const decision = checkIdempotency(
      existing.rows[0]
        ? {
            requestFingerprint: existing.rows[0].request_fingerprint,
            responseStatus: existing.rows[0].response_status,
            responseBody: existing.rows[0].response_body,
          }
        : null,
      fingerprint
    );

    if (decision.kind === 'replay') {
      await client.query('ROLLBACK'); // nothing to write, just echo the stored result
      return { outcome: 'replayed', status: decision.storedStatus, body: decision.storedBody };
    }
    if (decision.kind === 'conflict') {
      await client.query('ROLLBACK');
      return { outcome: 'idempotency_conflict' };
    }

    // decision.kind === 'no_record' — proceed with the real work.
    const competencyRow = await client.query(
      `SELECT id FROM competencies WHERE key = $1`,
      [input.competencyKey]
    );
    if (competencyRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return { outcome: 'competency_not_found' };
    }
    const competencyId = competencyRow.rows[0].id;

    const insertResult = await client.query(
      `INSERT INTO attempts (tenant_id, student_id, competency_id, score, evaluator_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.tenantId, input.studentId, competencyId, input.score, input.evaluatorId]
    );
    const attemptId = insertResult.rows[0].id;

    // Recompute readiness from scratch using the same DB-backed function we already
    // integration-tested — single source of truth, no duplicated logic here.
    const latestAttempts = await getLatestAttemptsByCompetency(input.tenantId, input.studentId);
    const readiness = calculateReadiness(latestAttempts);

    await client.query(
      `UPDATE students
       SET current_score = $1, status = $2, version = version + 1
       WHERE tenant_id = $3 AND id = $4`,
      [readiness.overallScore, readiness.status, input.tenantId, input.studentId]
    );

    const responseBody = { attemptId, readiness };
    await client.query(
      `INSERT INTO idempotency_records
         (tenant_id, idempotency_key, request_fingerprint, response_status, response_body, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '24 hours')`,
      [input.tenantId, input.idempotencyKey, fingerprint, 201, JSON.stringify(responseBody)]
    );

    await client.query('COMMIT');
    return { outcome: 'created', attemptId, readiness };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}