import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seed, SEED_IDS } from '../../src/db/seed';
import { pool } from '../../src/config/db';

beforeEach(async () => {
  await seed();
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/students/:id', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get(`/api/students/${SEED_IDS.studentComplete}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for a bearer token that does not match any user', async () => {
    const res = await request(app)
      .get(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', 'Bearer 00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(401);
  });

  it('returns 200 with correct readiness for a valid, complete student', async () => {
    const res = await request(app)
      .get(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`);

    expect(res.status).toBe(200);
    expect(res.body.readiness).toEqual({ overallScore: 80, status: 'READY' });
    expect(res.body.competencies.frontend).toEqual({ competencyKey: 'frontend', score: 80 });
  });

  it('returns 200 with INCOMPLETE status for a student missing a competency', async () => {
    const res = await request(app)
      .get(`/api/students/${SEED_IDS.studentIncomplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`);

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('INCOMPLETE');
    expect(res.body.readiness.overallScore).toBeNull();
  });

  it('returns 404 for a nonexistent student id', async () => {
    const res = await request(app)
      .get('/api/students/99999999-9999-9999-9999-999999999999')
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 (not leaking existence) for a REAL student belonging to a different tenant', async () => {
    // We need a user whose token belongs to tenantB to make this a genuine cross-tenant test.
    // seed.ts doesn't currently create a tenantB user — add one via direct SQL here, scoped to this test.
    const tenantBUserId = '66666666-6666-6666-6666-666666666666';
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, role) VALUES ($1, $2, 'evaluator@b.test', 'evaluator')`,
      [tenantBUserId, SEED_IDS.tenantB]
    );

    const res = await request(app)
      .get(`/api/students/${SEED_IDS.studentComplete}`) // belongs to tenantA
      .set('Authorization', `Bearer ${tenantBUserId}`);  // authenticated as tenantB

    expect(res.status).toBe(404); // same status/code as a nonexistent student — no leak
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});