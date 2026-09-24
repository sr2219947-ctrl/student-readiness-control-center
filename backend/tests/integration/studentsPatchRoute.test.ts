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

describe('PATCH /api/students/:id', () => {
  it('updates successfully with the correct version and returns the bumped version', async () => {
    const res = await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'Renamed via API', version: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SEED_IDS.studentComplete, version: 2 });
  });

  it('rejects a stale version with 409 and reports the current version', async () => {
    // First update succeeds, bumping version 1 -> 2
    await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'First', version: 1 });

    // Retry with the now-stale version 1
    const res = await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'Stale', version: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.fields.currentVersion).toBe('2');
  });

  it('rejects a request missing version with 400 and a field error', async () => {
    const res = await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'No Version' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.version).toBeDefined();
  });

  it('returns 404 for a nonexistent student', async () => {
    const res = await request(app)
      .patch('/api/students/99999999-9999-9999-9999-999999999999')
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'Nobody', version: 1 });

    expect(res.status).toBe(404);
  });

  it('returns 404 (not leaking existence) when patching a real student from a different tenant', async () => {
    const tenantBUserId = '66666666-6666-6666-6666-666666666666';
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, role) VALUES ($1, $2, 'evaluator@b.test', 'evaluator')`,
      [tenantBUserId, SEED_IDS.tenantB]
    );

    const res = await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`) // belongs to tenantA
      .set('Authorization', `Bearer ${tenantBUserId}`)     // authenticated as tenantB
      .send({ name: 'Should Not Apply', version: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Confirm it genuinely didn't apply
    const check = await pool.query('SELECT name FROM students WHERE id = $1', [SEED_IDS.studentComplete]);
    expect(check.rows[0].name).toBe('Complete Student'); // unchanged
  });

  it('rejects mass-assignment attempts — extra fields in the body are silently ignored, not applied', async () => {
    const res = await request(app)
      .patch(`/api/students/${SEED_IDS.studentComplete}`)
      .set('Authorization', `Bearer ${SEED_IDS.evaluator}`)
      .send({ name: 'Legit Update', version: 1, tenantId: SEED_IDS.tenantB, current_score: 999 });

    expect(res.status).toBe(200); // the allowed fields still go through fine

    // Confirm the student's tenant did NOT change, despite tenantId being in the body
    const check = await pool.query('SELECT tenant_id FROM students WHERE id = $1', [SEED_IDS.studentComplete]);
    expect(check.rows[0].tenant_id).toBe(SEED_IDS.tenantA); // still tenantA, unchanged
  });
});