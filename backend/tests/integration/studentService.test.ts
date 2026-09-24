import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { seed, SEED_IDS } from '../../src/db/seed';
import { getLatestAttemptsByCompetency, updateStudent } from '../../src/services/studentService';
import { calculateReadiness } from '../../src/domain/readiness';
import { pool } from '../../src/config/db';

// This is a REAL integration test — it hits your actual local Postgres,
// unlike the pure unit tests in tests/unit/. Re-seeds once before this file's tests run.
beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await pool.end(); // close the connection pool so vitest can exit cleanly
});

describe('getLatestAttemptsByCompetency (integration)', () => {
  it('returns all four competencies for a student with a full attempt set', async () => {
    const result = await getLatestAttemptsByCompetency(SEED_IDS.tenantA, SEED_IDS.studentComplete);

    expect(result.frontend).toEqual({ competencyKey: 'frontend', score: 80 });
    expect(result.backend).toEqual({ competencyKey: 'backend', score: 80 });
    expect(result.databases).toEqual({ competencyKey: 'databases', score: 80 });
    expect(result.problem_solving).toEqual({ competencyKey: 'problem_solving', score: 80 });
  });

  it('feeds correctly into calculateReadiness, producing READY at score 80', async () => {
    const attempts = await getLatestAttemptsByCompetency(SEED_IDS.tenantA, SEED_IDS.studentComplete);
    const readiness = calculateReadiness(attempts);

    expect(readiness.overallScore).toBe(80);
    expect(readiness.status).toBe('READY');
  });

  it('returns null for the missing competency of an incomplete student', async () => {
    const result = await getLatestAttemptsByCompetency(SEED_IDS.tenantA, SEED_IDS.studentIncomplete);

    expect(result.frontend).not.toBeNull();
    expect(result.backend).not.toBeNull();
    expect(result.databases).not.toBeNull();
    expect(result.problem_solving).toBeNull(); // seeded with only 3 attempts
  });

  it('feeds correctly into calculateReadiness, producing INCOMPLETE for a partial student', async () => {
    const attempts = await getLatestAttemptsByCompetency(SEED_IDS.tenantA, SEED_IDS.studentIncomplete);
    const readiness = calculateReadiness(attempts);

    expect(readiness.status).toBe('INCOMPLETE');
    expect(readiness.overallScore).toBeNull();
  });

  it('returns all nulls for a nonexistent student in the same tenant (no attempts, no crash)', async () => {
    const fakeStudentId = '99999999-9999-9999-9999-999999999999';
    const result = await getLatestAttemptsByCompetency(SEED_IDS.tenantA, fakeStudentId);

    expect(result.frontend).toBeNull();
    expect(result.backend).toBeNull();
    expect(result.databases).toBeNull();
    expect(result.problem_solving).toBeNull();
  });

  it('returns nulls when querying a real student under the WRONG tenant (tenant isolation)', async () => {
    // studentComplete belongs to tenantA — querying with tenantB should find nothing,
    // proving the tenant_id filter in the SQL actually does its job.
    const result = await getLatestAttemptsByCompetency(SEED_IDS.tenantB, SEED_IDS.studentComplete);

    expect(result.frontend).toBeNull();
    expect(result.backend).toBeNull();
    expect(result.databases).toBeNull();
    expect(result.problem_solving).toBeNull();
  });
});

describe('updateStudent (integration)', () => {
  beforeEach(async () => {
    await seed(); // reset to a known state (version 1) before each test in this block,
    // since these tests mutate the row and can't share state the way the read-only tests above do.
  });

  it('updates successfully when the expected version matches, and bumps version', async () => {
    const result = await updateStudent(
      SEED_IDS.tenantA,
      SEED_IDS.studentComplete,
      1, // seed.ts creates students at version 1
      { name: 'Updated Name' }
    );

    expect(result.outcome).toBe('updated');
    if (result.outcome === 'updated') {
      expect(result.newVersion).toBe(2);
    }

    const { rows } = await pool.query('SELECT name, version FROM students WHERE id = $1', [SEED_IDS.studentComplete]);
    expect(rows[0].name).toBe('Updated Name');
    expect(rows[0].version).toBe(2);
  });

  it('only updates the field provided, leaving the other untouched (COALESCE behavior)', async () => {
    await updateStudent(SEED_IDS.tenantA, SEED_IDS.studentComplete, 1, { email: 'new@a.test' });

    const { rows } = await pool.query('SELECT name, email FROM students WHERE id = $1', [SEED_IDS.studentComplete]);
    expect(rows[0].email).toBe('new@a.test');
    expect(rows[0].name).toBe('Complete Student'); // unchanged from seed
  });

  it('rejects a stale version with version_conflict and reports the current version', async () => {
    // First update succeeds, bumping version 1 -> 2
    await updateStudent(SEED_IDS.tenantA, SEED_IDS.studentComplete, 1, { name: 'First Update' });

    // Second update still claims version 1 — stale, since the row is now at version 2
    const result = await updateStudent(SEED_IDS.tenantA, SEED_IDS.studentComplete, 1, { name: 'Stale Update' });

    expect(result.outcome).toBe('version_conflict');
    if (result.outcome === 'version_conflict') {
      expect(result.currentVersion).toBe(2);
    }

    // Confirm the stale update did NOT partially apply
    const { rows } = await pool.query('SELECT name FROM students WHERE id = $1', [SEED_IDS.studentComplete]);
    expect(rows[0].name).toBe('First Update'); // not 'Stale Update'
  });

  it('returns not_found for a student in a different tenant (no existence leak)', async () => {
    // studentComplete belongs to tenantA; ask with tenantB's id
    const result = await updateStudent(SEED_IDS.tenantB, SEED_IDS.studentComplete, 1, { name: 'Should Not Apply' });

    expect(result.outcome).toBe('not_found');
  });

  it('returns not_found for a genuinely nonexistent student id', async () => {
    const fakeId = '99999999-9999-9999-9999-999999999999';
    const result = await updateStudent(SEED_IDS.tenantA, fakeId, 1, { name: 'Nobody' });

    expect(result.outcome).toBe('not_found');
  });
});