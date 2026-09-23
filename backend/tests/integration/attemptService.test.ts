import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { seed, SEED_IDS } from '../../src/db/seed';
import { submitAttempt } from '../../src/services/attemptService';
import { pool } from '../../src/config/db';

beforeEach(async () => {
  await seed(); // fresh state before every test in this file
});

afterAll(async () => {
  await pool.end();
});

describe('submitAttempt (integration)', () => {
  it('creates a new attempt on first submission', async () => {
    const result = await submitAttempt({
      tenantId: SEED_IDS.tenantA,
      studentId: SEED_IDS.studentComplete,
      competencyKey: 'frontend',
      score: 95,
      evaluatorId: SEED_IDS.evaluator,
      idempotencyKey: 'key-single-submit',
    });

    expect(result.outcome).toBe('created');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM attempts WHERE student_id = $1 AND competency_id =
         (SELECT id FROM competencies WHERE key = 'frontend')`,
      [SEED_IDS.studentComplete]
    );
    // seed already gives studentComplete 1 frontend attempt; this submission adds one more
    expect(rows[0].count).toBe(2);
  });

  it('rejects a retry with the same key but a different score (conflict)', async () => {
    await submitAttempt({
      tenantId: SEED_IDS.tenantA, studentId: SEED_IDS.studentComplete,
      competencyKey: 'frontend', score: 95, evaluatorId: SEED_IDS.evaluator,
      idempotencyKey: 'key-conflict-test',
    });

    const second = await submitAttempt({
      tenantId: SEED_IDS.tenantA, studentId: SEED_IDS.studentComplete,
      competencyKey: 'frontend', score: 50, evaluatorId: SEED_IDS.evaluator, // different score, same key
      idempotencyKey: 'key-conflict-test',
    });

    expect(second.outcome).toBe('idempotency_conflict');
  });

  it('two PARALLEL requests with the same key and same body create exactly ONE attempt', async () => {
    const makeRequest = () =>
      submitAttempt({
        tenantId: SEED_IDS.tenantA,
        studentId: SEED_IDS.studentIncomplete,
        competencyKey: 'problem_solving', // the one competency studentIncomplete is missing
        score: 88,
        evaluatorId: SEED_IDS.evaluator,
        idempotencyKey: 'key-parallel-test',
      });

    // Fire both at the same time — this is what actually exercises the FOR UPDATE lock.
    const [resultA, resultB] = await Promise.all([makeRequest(), makeRequest()]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    // Exactly one should have created the attempt, the other should have replayed it.
    expect(outcomes).toEqual(['created', 'replayed']);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM attempts
       WHERE student_id = $1 AND competency_id = (SELECT id FROM competencies WHERE key = 'problem_solving')`,
      [SEED_IDS.studentIncomplete]
    );
    expect(rows[0].count).toBe(1); // NOT 2 — this is the whole point of the test
  });

  it('returns competency_not_found for an unknown competency key gracefully', async () => {
    const badInput = {
      tenantId: SEED_IDS.tenantA,
      studentId: SEED_IDS.studentComplete,
      competencyKey: 'nonexistent',
      score: 50,
      evaluatorId: SEED_IDS.evaluator,
      idempotencyKey: 'key-bad-competency',
    } as unknown as Parameters<typeof submitAttempt>[0];

    const result = await submitAttempt(badInput);

    expect(result.outcome).toBe('competency_not_found');
  });
});