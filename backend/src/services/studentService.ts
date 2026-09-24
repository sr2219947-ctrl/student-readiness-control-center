import { pool } from '../config/db';
import { pickLatestAttempt, type CompetencyKey, type LatestAttempt } from '../domain/readiness';

interface AttemptRow {
  id: string;
  competency_key: CompetencyKey;
  score: string; // pg returns NUMERIC as a string — must parse
  submitted_at: string;
}

// Fetches all non-voided attempts for a student, scoped to tenant, then
// reduces them to "latest per competency" using the same tie-break rule
// tested in readiness.test.ts.
export async function getLatestAttemptsByCompetency(
  tenantId: string,
  studentId: string
): Promise<Record<CompetencyKey, LatestAttempt>> {
  const { rows } = await pool.query<AttemptRow>(
    `SELECT a.id, c.key AS competency_key, a.score, a.submitted_at
     FROM attempts a
     JOIN competencies c ON c.id = a.competency_id
     WHERE a.tenant_id = $1
       AND a.student_id = $2
       AND a.is_void = false`,
    [tenantId, studentId]
  );

  const grouped: Record<CompetencyKey, AttemptRow[]> = {
    frontend: [], backend: [], databases: [], problem_solving: [],
  };
  for (const row of rows) {
    grouped[row.competency_key].push(row);
  }

  const result = {} as Record<CompetencyKey, LatestAttempt>;
  for (const key of Object.keys(grouped) as CompetencyKey[]) {
    const latest = pickLatestAttempt(
      grouped[key].map((r) => ({ id: r.id, submittedAt: r.submitted_at, score: Number(r.score) }))
    );
    result[key] = latest ? { competencyKey: key, score: latest.score } : null;
  }

  return result;
}

export type UpdateStudentResult =
  | { outcome: 'updated'; newVersion: number }
  | { outcome: 'version_conflict'; currentVersion: number }
  | { outcome: 'not_found' };

interface UpdateStudentInput {
  name?: string;
  email?: string;
}

// Only 'name' and 'email' are updatable — hardcoded, not derived from the
// request body, so there is no way for a client to smuggle in an update to
// tenant_id, current_score, or version itself (mass-assignment protection).
export async function updateStudent(
  tenantId: string,
  studentId: string,
  expectedVersion: number,
  fields: UpdateStudentInput
): Promise<UpdateStudentResult> {
  if (fields.name === undefined && fields.email === undefined) {
    throw new Error('At least one of name or email must be provided');
  }

  const result = await pool.query(
    `UPDATE students
     SET name = COALESCE($1, name),
         email = COALESCE($2, email),
         version = version + 1
     WHERE tenant_id = $3 AND id = $4 AND version = $5
     RETURNING version`,
    [fields.name ?? null, fields.email ?? null, tenantId, studentId, expectedVersion]
  );

  if (result.rows.length > 0) {
    return { outcome: 'updated', newVersion: result.rows[0].version };
  }

  const check = await pool.query(
    `SELECT version FROM students WHERE tenant_id = $1 AND id = $2`,
    [tenantId, studentId]
  );

  if (check.rows.length === 0) {
    return { outcome: 'not_found' };
  }
  return { outcome: 'version_conflict', currentVersion: check.rows[0].version };
}