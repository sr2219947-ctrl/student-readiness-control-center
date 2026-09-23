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