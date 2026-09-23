import { pool } from '../config/db';

// Deterministic UUIDs so tests can reference exact rows without querying for them first.
export const SEED_IDS = {
  tenantA: '11111111-1111-1111-1111-111111111111',
  tenantB: '22222222-2222-2222-2222-222222222222',
  evaluator: '33333333-3333-3333-3333-333333333333',
  studentComplete: '44444444-4444-4444-4444-444444444444',   // has all 4 competencies
  studentIncomplete: '55555555-5555-5555-5555-555555555555', // missing one competency
};

export async function seed(): Promise<void> {
  // Wipe in FK-safe order, then rebuild — keeps the script idempotent (safe to rerun).
  await pool.query('TRUNCATE attempts, idempotency_records, students, users, competencies, tenants CASCADE');

  await pool.query(
    `INSERT INTO tenants (id, name, status) VALUES ($1, 'Tenant A', 'active'), ($2, 'Tenant B', 'active')`,
    [SEED_IDS.tenantA, SEED_IDS.tenantB]
  );

  await pool.query(
    `INSERT INTO users (id, tenant_id, email, role) VALUES ($1, $2, 'evaluator@a.test', 'evaluator')`,
    [SEED_IDS.evaluator, SEED_IDS.tenantA]
  );

  await pool.query(
    `INSERT INTO competencies (key, weight) VALUES
     ('frontend', 0.30), ('backend', 0.30), ('databases', 0.25), ('problem_solving', 0.15)`
  );

  await pool.query(
    `INSERT INTO students (id, tenant_id, name, email) VALUES
     ($1, $2, 'Complete Student', 'complete@a.test'),
     ($3, $2, 'Incomplete Student', 'incomplete@a.test')`,
    [SEED_IDS.studentComplete, SEED_IDS.tenantA, SEED_IDS.studentIncomplete]
  );

  // studentComplete: one attempt per competency (all 4) — a valid full set
  const competencyRows = await pool.query('SELECT id, key FROM competencies');
  const compIdByKey: Record<string, string> = {};
  for (const row of competencyRows.rows) compIdByKey[row.key] = row.id;

  for (const [key, score] of [
    ['frontend', 80], ['backend', 80], ['databases', 80], ['problem_solving', 80],
  ] as const) {
    await pool.query(
      `INSERT INTO attempts (tenant_id, student_id, competency_id, score, evaluator_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [SEED_IDS.tenantA, SEED_IDS.studentComplete, compIdByKey[key], score, SEED_IDS.evaluator]
    );
  }

  // studentIncomplete: only 3 of 4 competencies (missing problem_solving)
  for (const [key, score] of [
    ['frontend', 90], ['backend', 90], ['databases', 90],
  ] as const) {
    await pool.query(
      `INSERT INTO attempts (tenant_id, student_id, competency_id, score, evaluator_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [SEED_IDS.tenantA, SEED_IDS.studentIncomplete, compIdByKey[key], score, SEED_IDS.evaluator]
    );
  }
}

// Allow running directly: `npx tsx src/db/seed.ts`
if (require.main === module) {
  seed()
    .then(() => { console.log('Seed complete.'); return pool.end(); })
    .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}