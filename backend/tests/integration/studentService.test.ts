import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seed, SEED_IDS } from '../../src/db/seed';
import { getLatestAttemptsByCompetency } from '../../src/services/studentService';
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